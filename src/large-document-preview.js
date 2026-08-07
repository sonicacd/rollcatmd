import { syntaxTree } from '@codemirror/language';
import { Decoration, ViewPlugin } from '@codemirror/view';

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
