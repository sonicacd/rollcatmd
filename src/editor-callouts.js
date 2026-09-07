// ProseMirror decorations affect presentation only. Markdown and undo history
// retain the original callout marker, including while its title is edited.
export function calloutEditorPlugin({ pmState, pmView }) {
  const { Plugin } = pmState;
  const { Decoration, DecorationSet } = pmView;
  function build(state) {
    const decorations = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'codeBlock') {
        decorations.push(Decoration.widget(pos + 1, () => {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'code-copy-button editor-code-copy-button';
          button.contentEditable = 'false'; button.textContent = '复制代码';
          button.addEventListener('mousedown', (event) => event.preventDefault());
          button.addEventListener('click', async (event) => {
            event.preventDefault();
            try { const { copyText } = await import('./local-images.js'); await copyText(node.textContent); button.textContent = '已复制'; }
            catch { button.textContent = '复制失败'; }
            setTimeout(() => { button.textContent = '复制代码'; }, 1800);
          });
          return button;
        }, { side: -1, stopEvent: () => true, ignoreSelection: true }));
        return false;
      }
      if (node.type.name !== 'blockQuote') return;
      const first = node.firstChild;
      if (!first || first.type.name !== 'paragraph') return;
      const match = /^\[!([a-z][a-z0-9_-]*)\][+-]?\s*/i.exec(first.textContent);
      if (!match) return;
      const type = match[1].toLowerCase();
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: `obsidian-callout obsidian-callout-${type} editor-callout` }));
      const start = pos + 2;
      const editingTitle = state.selection.from <= start + first.content.size && state.selection.to >= start;
      decorations.push(Decoration.node(pos + 1, pos + 1 + first.nodeSize, { class: 'editor-callout-title' }));
      if (!editingTitle) {
        decorations.push(Decoration.inline(start, start + match[0].length, { class: 'editor-callout-marker-hidden' }));
      }
    });
    return DecorationSet.create(state.doc, decorations);
  }
  return { wysiwygPlugins: [() => new Plugin({
    state: { init: (_, state) => build(state), apply: (tr, previous, _old, next) => tr.docChanged || tr.selectionSet ? build(next) : previous },
    props: { decorations(state) { return this.getState(state); } }
  })] };
}
