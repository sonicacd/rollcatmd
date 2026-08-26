import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMarkdownAstFindSnapshot,
  buildMappedTextBlocks,
  decodeFindReplaceEscapes,
  findMatchIndex,
  findTextMatches,
  mapVisibleFindSnapshotToSource,
  mappedTextNodeId,
  mappedTextOffsetAtPosition,
  mappedTextRange,
  offsetToMarkdownPosition,
  replaceAllText
} from '../src/find-replace.js';

function markdownNode(type, { literal = null, sourcepos = null, children = [] } = {}) {
  const node = {
    type,
    literal,
    sourcepos,
    firstChild: null,
    next: null
  };

  children.forEach((child, index) => {
    if (index === 0) {
      node.firstChild = child;
    } else {
      children[index - 1].next = child;
    }
  });

  return node;
}

test('decodes supported find and replace escape sequences', () => {
  assert.equal(decodeFindReplaceEscapes('\\n\\n'), '\n\n');
  assert.equal(decodeFindReplaceEscapes('\\r\\t\\\\'), '\r\t\\');
});

test('preserves unknown escape sequences and a trailing backslash', () => {
  assert.equal(decodeFindReplaceEscapes('\\x\\q\\'), '\\x\\q\\');
});

test('finds literal text case-insensitively without treating punctuation as regex', () => {
  assert.deepEqual(findTextMatches('A.b a.B a-b', 'a.b'), [
    { from: 0, to: 3 },
    { from: 4, to: 7 }
  ]);
});

test('finds Unicode text and supports case-sensitive searches', () => {
  assert.deepEqual(findTextMatches('滚猫md 滚猫MD', '滚猫MD'), [
    { from: 0, to: 4 },
    { from: 5, to: 9 }
  ]);
  assert.deepEqual(findTextMatches('滚猫md 滚猫MD', '滚猫MD', { caseSensitive: true }), [
    { from: 5, to: 9 }
  ]);
});

test('chooses the next or previous result and wraps at document edges', () => {
  const matches = findTextMatches('one two one', 'one');

  assert.equal(findMatchIndex(matches, 1), 1);
  assert.equal(findMatchIndex(matches, 99), 0);
  assert.equal(findMatchIndex(matches, 8, -1), 0);
  assert.equal(findMatchIndex(matches, 0, -1), 1);
});

test('replaces all matches with replacement text literally', () => {
  const text = 'cat CAT cat';
  const matches = findTextMatches(text, 'cat');

  assert.equal(replaceAllText(text, matches, '$& dog'), '$& dog $& dog $& dog');
  assert.equal(replaceAllText(text, [], 'dog'), text);
});

test('finds escaped line breaks and collapses double line breaks with replace all', () => {
  const text = 'first\n\nsecond\n\nthird';
  const matches = findTextMatches(text, '\\n\\n');

  assert.deepEqual(matches, [
    { from: 5, to: 7 },
    { from: 13, to: 15 }
  ]);
  assert.equal(replaceAllText(text, matches, '\\n'), 'first\nsecond\nthird');
});

test('maps visible rich-text characters and empty blocks back to editor positions', () => {
  const documentParent = {};
  const mapped = buildMappedTextBlocks([
    { from: 1, to: 2, parent: documentParent, segments: [{ text: 'a', from: 1 }] },
    { from: 4, to: 4, parent: documentParent, segments: [] },
    { from: 6, to: 7, parent: documentParent, segments: [{ text: 'b', from: 6 }] }
  ]);

  assert.equal(mapped.text, 'a\n\nb');
  assert.deepEqual(mappedTextRange(mapped.spans, 1, 3), [2, 6]);
  assert.equal(mappedTextOffsetAtPosition(mapped.spans, 1), 0);
  assert.equal(mappedTextOffsetAtPosition(mapped.spans, 2), 1);
  assert.equal(mappedTextOffsetAtPosition(mapped.spans, 6), 3);
});

test('marks atom text and cross-container separators as unsafe to replace', () => {
  const mapped = buildMappedTextBlocks([
    {
      from: 1,
      to: 3,
      parent: {},
      segments: [
        { text: 'a', from: 1 },
        { text: '\uFFFC', from: 2, replaceable: false }
      ]
    },
    {
      from: 7,
      to: 8,
      parent: {},
      segments: [{ text: 'b', from: 7 }]
    }
  ]);

  assert.equal(mapped.text, 'a\uFFFC\nb');
  assert.equal(mapped.spans[1].replaceable, false);
  assert.equal(mapped.spans[2].replaceable, false);
});

test('maps rendered Markdown text to raw source without exposing link targets or comments', () => {
  const markdown = [
    '[foo](https://foo.com)',
    '',
    '**foo**',
    '',
    '`foo`',
    '',
    '<!-- foo stays hidden -->',
    '',
    'foo'
  ].join('\n');
  const root = markdownNode('document', {
    children: [
      markdownNode('paragraph', {
        children: [markdownNode('link', {
          children: [markdownNode('text', {
            literal: 'foo',
            sourcepos: [[1, 2], [1, 4]]
          })]
        })]
      }),
      markdownNode('paragraph', {
        children: [markdownNode('strong', {
          children: [markdownNode('text', {
            literal: 'foo',
            sourcepos: [[3, 3], [3, 5]]
          })]
        })]
      }),
      markdownNode('paragraph', {
        children: [markdownNode('code', {
          literal: 'foo',
          sourcepos: [[5, 1], [5, 5]]
        })]
      }),
      markdownNode('htmlBlock', {
        literal: '<!-- foo stays hidden -->',
        sourcepos: [[7, 1], [7, 25]]
      }),
      markdownNode('paragraph', {
        children: [markdownNode('text', {
          literal: 'foo',
          sourcepos: [[9, 1], [9, 3]]
        })]
      })
    ]
  });
  const snapshot = buildMarkdownAstFindSnapshot(markdown, root);
  const matches = findTextMatches(snapshot.text, 'foo');
  const sourceRanges = matches.map((match) => (
    mappedTextRange(snapshot.spans, match.from, match.to)
  ));

  assert.equal(snapshot.text, 'foo\nfoo\nfoo\nfoo');
  assert.equal(matches.length, 4);
  assert.deepEqual(
    sourceRanges.map(([from, to]) => markdown.slice(from, to)),
    ['foo', 'foo', 'foo', 'foo']
  );
  assert.equal(markdown.slice(sourceRanges[0][1]), '](https://foo.com)\n\n**foo**\n\n`foo`\n\n<!-- foo stays hidden -->\n\nfoo');
});

test('reader source mapping preserves front matter and skips hidden callout labels', () => {
  const markdown = '---\ntitle: keep\n---\nTARGET\n\n> [!note] Title\n> TARGET body';
  const root = markdownNode('document', {
    children: [
      markdownNode('paragraph', {
        children: [markdownNode('text', {
          literal: 'TARGET',
          sourcepos: [[4, 1], [4, 6]]
        })]
      }),
      markdownNode('blockQuote', {
        children: [markdownNode('paragraph', {
          children: [
            markdownNode('text', {
              literal: '[!note] Title',
              sourcepos: [[6, 3], [6, 15]]
            }),
            markdownNode('text', {
              literal: 'TARGET body',
              sourcepos: [[7, 3], [7, 13]]
            })
          ]
        })]
      })
    ]
  });
  const snapshot = buildMarkdownAstFindSnapshot(markdown, root);
  const matches = findTextMatches(snapshot.text, 'TARGET');
  let replaced = markdown;

  [...matches].reverse().forEach((match) => {
    const [from, to] = mappedTextRange(snapshot.spans, match.from, match.to);
    replaced = `${replaced.slice(0, from)}REPLACED${replaced.slice(to)}`;
  });

  assert.equal(snapshot.text, 'TARGET\nTARGET body');
  assert.equal(
    replaced,
    '---\ntitle: keep\n---\nREPLACED\n\n> [!note] Title\n> REPLACED body'
  );
});

test('maps escaped characters and entities to their complete raw source spans', () => {
  const markdown = '\\* &amp;';
  const root = markdownNode('document', {
    children: [markdownNode('paragraph', {
      children: [
        markdownNode('text', { literal: '*', sourcepos: [[1, 1], [1, 1]] }),
        markdownNode('text', { literal: '&', sourcepos: [[1, 4], [1, 8]] })
      ]
    })]
  });
  const snapshot = buildMarkdownAstFindSnapshot(markdown, root);
  const star = findTextMatches(snapshot.text, '*')[0];
  const ampersand = findTextMatches(snapshot.text, '&')[0];

  assert.equal(snapshot.text, '*&');
  assert.deepEqual(mappedTextRange(snapshot.spans, star.from, star.to), [0, 2]);
  assert.deepEqual(mappedTextRange(snapshot.spans, ampersand.from, ampersand.to), [3, 8]);
});

test('keeps inline Markdown text continuous but refuses unsafe cross-leaf replacement', () => {
  const markdown = 'Hello *World* and <b>HTML</b> tail';
  const root = markdownNode('document', {
    children: [markdownNode('paragraph', {
      children: [
        markdownNode('text', { literal: 'Hello ', sourcepos: [[1, 1], [1, 6]] }),
        markdownNode('emph', {
          children: [markdownNode('text', {
            literal: 'World',
            sourcepos: [[1, 8], [1, 12]]
          })]
        }),
        markdownNode('text', { literal: ' and ', sourcepos: [[1, 14], [1, 18]] }),
        markdownNode('htmlInline', { literal: '<b>', sourcepos: [[1, 19], [1, 21]] }),
        markdownNode('text', { literal: 'HTML', sourcepos: [[1, 22], [1, 25]] }),
        markdownNode('htmlInline', { literal: '</b>', sourcepos: [[1, 26], [1, 29]] }),
        markdownNode('text', { literal: ' tail', sourcepos: [[1, 30], [1, 34]] })
      ]
    })]
  });
  const snapshot = buildMarkdownAstFindSnapshot(markdown, root);
  const phrase = findTextMatches(snapshot.text, 'Hello World')[0];
  const world = findTextMatches(snapshot.text, 'World')[0];
  const htmlPhrase = findTextMatches(snapshot.text, 'and HTML tail')[0];

  assert.equal(snapshot.text, 'Hello World and HTML tail');
  assert.equal(mappedTextRange(snapshot.spans, phrase.from, phrase.to), null);
  assert.deepEqual(mappedTextRange(snapshot.spans, world.from, world.to), [7, 12]);
  assert.equal(mappedTextRange(snapshot.spans, htmlPhrase.from, htmlPhrase.to), null);
});

test('keeps astral and unknown entities searchable without splitting an entity token', () => {
  const markdown = 'x&#x1F600;y &bogus;';
  const root = markdownNode('document', {
    children: [markdownNode('paragraph', {
      children: [markdownNode('text', {
        literal: 'x😀y &bogus;',
        sourcepos: [[1, 1], [1, 20]]
      })]
    })]
  });
  const snapshot = buildMarkdownAstFindSnapshot(markdown, root);
  const emoji = findTextMatches(snapshot.text, '😀')[0];
  const emojiStart = snapshot.text.indexOf('😀');
  const bogus = findTextMatches(snapshot.text, '&bogus;')[0];

  assert.equal(snapshot.text, 'x😀y &bogus;');
  assert.deepEqual(mappedTextRange(snapshot.spans, emoji.from, emoji.to), [1, 10]);
  assert.equal(mappedTextRange(snapshot.spans, emojiStart, emojiStart + 1), null);
  assert.deepEqual(
    markdown.slice(...mappedTextRange(snapshot.spans, bogus.from, bogus.to)),
    '&bogus;'
  );
});

test('only hides a callout marker at the start of a blockquote', () => {
  const markdown = '> ordinary\n> [!note] visible';
  const root = markdownNode('document', {
    children: [markdownNode('blockQuote', {
      children: [markdownNode('paragraph', {
        children: [
          markdownNode('text', {
            literal: 'ordinary',
            sourcepos: [[1, 3], [1, 10]]
          }),
          markdownNode('softbreak', { sourcepos: [[1, 11], [1, 11]] }),
          markdownNode('text', {
            literal: '[!note] visible',
            sourcepos: [[2, 3], [2, 17]]
          })
        ]
      })]
    })]
  });
  const snapshot = buildMarkdownAstFindSnapshot(markdown, root);

  assert.equal(snapshot.text, 'ordinary\n[!note] visible');
  assert.equal(findTextMatches(snapshot.text, 'visible').length, 1);
});

test('uses visible reader text as canonical and maps only trustworthy source groups', () => {
  const visible = {
    text: 'safe\nvisible html\nbody',
    spans: [
      ...Array.from({ length: 4 }, (_, index) => ({ nodeId: 1, domOffset: index })),
      { separator: true },
      ...Array.from({ length: 12 }, (_, index) => ({ nodeId: 2, domOffset: index })),
      { separator: true },
      ...Array.from({ length: 4 }, (_, index) => ({ nodeId: 3, domOffset: index }))
    ]
  };
  const source = {
    text: 'safe\nalert\nbody',
    spans: [
      ...Array.from({ length: 4 }, (_, index) => ({
        from: 10 + index,
        to: 11 + index,
        leafId: 'safe',
        nodeId: 1,
        tokenId: `${10 + index}:${11 + index}`
      })),
      { separator: true, replaceable: false },
      ...Array.from({ length: 5 }, (_, index) => ({
        from: 20 + index,
        to: 21 + index,
        leafId: index < 2 ? 'hidden-a' : 'hidden-b',
        nodeId: 2,
        tokenId: `${20 + index}:${21 + index}`
      })),
      { separator: true, replaceable: false },
      ...Array.from({ length: 4 }, (_, index) => ({
        from: 30 + index,
        to: 31 + index,
        leafId: 'body',
        nodeId: 3,
        tokenId: `${30 + index}:${31 + index}`
      }))
    ]
  };
  const mapped = mapVisibleFindSnapshotToSource(visible, source);
  const safe = findTextMatches(mapped.text, 'safe')[0];
  const html = findTextMatches(mapped.text, 'visible html')[0];
  const body = findTextMatches(mapped.text, 'body')[0];

  assert.equal(mapped.text, visible.text);
  assert.deepEqual(mappedTextRange(mapped.spans, safe.from, safe.to), [10, 14]);
  assert.equal(mappedTextRange(mapped.spans, html.from, html.to), null);
  assert.deepEqual(mappedTextRange(mapped.spans, body.from, body.to), [30, 34]);
});

test('leaves duplicate renderer node identifiers find-only', () => {
  const visible = {
    text: 'safe',
    spans: Array.from({ length: 4 }, () => ({ nodeId: 7 }))
  };
  const source = {
    text: 'safe',
    spans: Array.from({ length: 4 }, (_, index) => ({
      from: index,
      to: index + 1,
      leafId: 'leaf',
      nodeId: 7,
      tokenId: `${index}:${index + 1}`
    }))
  };
  const mapped = mapVisibleFindSnapshotToSource(visible, source, {
    invalidNodeIds: [7]
  });

  assert.equal(findTextMatches(mapped.text, 'safe').length, 1);
  assert.equal(mappedTextRange(mapped.spans, 0, 4), null);
});

test('uses one complete reader node when calculating highlight ordinals', () => {
  const spans = [
    { nodeId: 1 },
    { nodeId: 2 },
    { nodeId: 1 },
    { nodeId: 1 },
    { nodeId: 1 },
    { nodeId: 1 }
  ];

  assert.equal(mappedTextNodeId(spans, 0, 2), null);
  assert.equal(mappedTextNodeId(spans, 2, 4), 1);
  assert.equal(mappedTextNodeId(spans, 4, 6), 1);
});

test('converts string offsets to Toast UI one-based Markdown positions', () => {
  const text = 'abc\n你好\n';

  assert.deepEqual(offsetToMarkdownPosition(text, 0), [1, 1]);
  assert.deepEqual(offsetToMarkdownPosition(text, 4), [2, 1]);
  assert.deepEqual(offsetToMarkdownPosition(text, 6), [2, 3]);
  assert.deepEqual(offsetToMarkdownPosition(text, text.length), [3, 1]);
});
