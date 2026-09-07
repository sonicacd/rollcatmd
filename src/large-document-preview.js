import { syntaxTree } from '@codemirror/language';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';

class MarkdownImageWidget extends WidgetType {
  constructor(source, alt) { super(); this.source = source; this.alt = alt; }
  eq(other) { return this.source === other.source && this.alt === other.alt; }
  toDOM(view) {
    const image = document.createElement('img');
    image.alt = this.alt; image.className = 'cm-markdown-image';
    image.src = this.source;
    image.style.cssText = 'max-width:100%;max-height:480px;object-fit:contain;vertical-align:middle';
    image.addEventListener('load', () => view.requestMeasure());
    image.addEventListener('error', () => view.requestMeasure());
    image.dataset.markdownSource = this.source;
    queueMicrotask(() => view.dom.dispatchEvent(new CustomEvent('markdown-media-visible', { bubbles: true })));
    return image;
  }
  ignoreEvent() { return false; }
}

class CodeCopyWidget extends WidgetType {
  constructor(from, to) { super(); this.from = from; this.to = to; }
  eq(other) { return this.from === other.from && this.to === other.to; }
  toDOM(view) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'code-copy-button cm-code-copy-button'; button.textContent = '复制代码';
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      const source = view.state.doc.sliceString(this.from, this.to);
      const text = source.replace(/^ {0,3}(?:`{3,}|~{3,})[^\n]*\n/, '').replace(/\n {0,3}(?:`{3,}|~{3,})\s*$/, '');
      try { const { copyText } = await import('./local-images.js'); await copyText(text); button.textContent = '已复制'; }
      catch { button.textContent = '复制失败'; }
    });
    return button;
  }
  ignoreEvent() { return true; }
}

const headingPattern = /^ATXHeading([1-6])$/;

const hiddenPreviewNodes = new Set([
  'CodeInfo',
  'CodeMark',
  'EmphasisMark',
  'HeaderMark',
  'LinkMark',
  'QuoteMark',
  'StrikethroughMark'
]);

const blockNodeClasses = new Map([
  ['Blockquote', 'cm-md-blockquote'],
  ['BulletList', 'cm-md-list'],
  ['FencedCode', 'cm-md-codeblock'],
  ['HorizontalRule', 'cm-md-horizontal-rule'],
  ['OrderedList', 'cm-md-list'],
  ['Table', 'cm-md-table'],
  ['TableHeader', 'cm-md-table-header']
]);

function hasAncestor(node, name) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === name) {
      return true;
    }
  }

  return false;
}

function shouldHidePreviewNode(node) {
  if (hiddenPreviewNodes.has(node.name)) {
    return true;
  }

  return (node.name === 'URL' || node.name === 'LinkLabel') &&
    (hasAncestor(node, 'Link') || hasAncestor(node, 'Image'));
}

function addLineClasses(lineClasses, documentText, from, to, visibleFrom, visibleTo, className) {
  const start = Math.max(from, visibleFrom);
  const end = Math.min(to, visibleTo);

  if (end < start) {
    return;
  }

  let line = documentText.lineAt(start);

  while (line.from <= end) {
    const classes = lineClasses.get(line.from) || new Set();
    classes.add(className);
    lineClasses.set(line.from, classes);

    if (line.to >= end || line.number >= documentText.lines) {
      break;
    }

    line = documentText.line(line.number + 1);
  }
}

function activeLineStarts(state) {
  if (state.readOnly) {
    return new Set();
  }

  return new Set(
    state.selection.ranges.map((range) => state.doc.lineAt(range.head).from)
  );
}

export function buildLargeDocumentPreviewDecorations(view) {
  const decorations = [];
  const lineClasses = new Map();
  const activeLines = activeLineStarts(view.state);
  const documentText = view.state.doc;
  const tree = syntaxTree(view.state);

  for (const visibleRange of view.visibleRanges) {
    tree.iterate({
      from: visibleRange.from,
      to: visibleRange.to,
      enter(reference) {
        const { node } = reference;
        if (node.name === 'Image') {
          const line = documentText.lineAt(node.from);
          const match = /^!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^]*?["'])?\s*\)$/.exec(documentText.sliceString(node.from, node.to));
          const source = match?.[2] || match?.[3];
          if (source && !/^(?:javascript|vbscript|file|http):/i.test(source) && node.to <= line.to && !activeLines.has(line.from)) {
            decorations.push(Decoration.replace({ widget: new MarkdownImageWidget(source, match[1]) }).range(node.from, node.to));
            return false;
          }
        }
        if (node.name === 'FencedCode' && node.from >= visibleRange.from) {
          decorations.push(Decoration.widget({ widget: new CodeCopyWidget(node.from, node.to), side: -1 }).range(node.from));
        }
        const headingMatch = headingPattern.exec(node.name);

        if (headingMatch) {
          addLineClasses(
            lineClasses,
            documentText,
            node.from,
            node.to,
            visibleRange.from,
            visibleRange.to,
            `cm-md-heading cm-md-heading-${headingMatch[1]}`
          );
        }

        const blockClass = blockNodeClasses.get(node.name);

        if (blockClass) {
          addLineClasses(
            lineClasses,
            documentText,
            node.from,
            node.to,
            visibleRange.from,
            visibleRange.to,
            blockClass
          );
        }

        if (!shouldHidePreviewNode(node) || node.from === node.to) {
          return;
        }

        const nodeLine = documentText.lineAt(node.from);

        // View-plugin decorations must not collapse content across line
        // boundaries. Malformed or multiline reference labels stay visible.
        if (node.to > nodeLine.to) {
          return;
        }

        // Like Obsidian's Live Preview, reveal the original Markdown syntax on
        // the line that is currently being edited.
        if (activeLines.has(nodeLine.from)) {
          return;
        }

        decorations.push(Decoration.replace({}).range(node.from, node.to));
      }
    });
  }

  for (const [lineStart, classes] of lineClasses) {
    decorations.push(
      Decoration.line({ class: [...classes].join(' ') }).range(lineStart)
    );
  }

  return Decoration.set(decorations, true);
}

export const largeDocumentPreview = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildLargeDocumentPreviewDecorations(view);
      this.syntaxTree = syntaxTree(view.state);
    }

    update(update) {
      const nextSyntaxTree = syntaxTree(update.state);

      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.startState.readOnly !== update.state.readOnly ||
        nextSyntaxTree !== this.syntaxTree
      ) {
        this.decorations = buildLargeDocumentPreviewDecorations(update.view);
      }

      this.syntaxTree = nextSyntaxTree;
    }
  },
  {
    decorations: (plugin) => plugin.decorations
  }
);
