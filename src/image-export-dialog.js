const PHASE_LABELS = Object.freeze({
  preparing: '正在准备导出',
  analyzing: '正在解析文档',
  analysis: '正在解析文档',
  parsing: '正在解析文档',
  downloading: '正在下载网络图片',
  'downloading-images': '正在下载网络图片',
  fetching: '正在下载网络图片',
  images: '正在下载网络图片',
  layout: '正在排版',
  rendering: '正在生成图片',
  render: '正在生成图片',
  packing: '正在打包',
  packaging: '正在打包',
  zip: '正在打包',
  saving: '正在保存',
  write: '正在保存',
  cancelling: '正在取消'
});

function findRequiredElement(dialog, selector) {
  const element = dialog.querySelector(selector);
  if (!element) {
    throw new Error(`图片导出对话框缺少元素：${selector}`);
  }
  return element;
}

function normalizeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

function formatProgressDetail({ phase, completed, total, pageCount }) {
  if (total > 0) {
    if (['analyzing', 'analysis', 'parsing', 'layout'].includes(phase)) {
      return `已处理 ${completed.toLocaleString()} / ${total.toLocaleString()} 个字符`;
    }

    if (['downloading', 'downloading-images', 'fetching', 'images'].includes(phase)) {
      return `正在处理第 ${Math.min(completed + 1, total).toLocaleString()} / ${total.toLocaleString()} 张网络图片`;
    }

    if (['rendering', 'render'].includes(phase)) {
      const percent = Math.round((Math.min(completed, total) / total) * 100);
      return pageCount > 0
        ? `已生成 ${pageCount.toLocaleString()} 页 · 已处理 ${percent}%`
        : `已处理 ${percent}%`;
    }

    return `${completed.toLocaleString()} / ${total.toLocaleString()}`;
  }

  if (pageCount > 0) {
    return `已生成 ${pageCount.toLocaleString()} 页`;
  }

  return PHASE_LABELS[phase] ? `${PHASE_LABELS[phase]}…` : '正在处理…';
}

function formatStats({ pageCount, includedImages, failedImages }) {
  const parts = [];

  if (pageCount > 0) {
    parts.push(`已生成 ${pageCount.toLocaleString()} 页`);
  }
  if (includedImages > 0) {
    parts.push(`已包含 ${includedImages.toLocaleString()} 张网络图片`);
  }
  if (failedImages > 0) {
    parts.push(`${failedImages.toLocaleString()} 张网络图片未包含`);
  }

  return parts.join(' · ');
}

export function getImageExportDialogElements(root = document) {
  const dialog = root.getElementById('imageExportDialog');
  if (!dialog) {
    throw new Error('找不到图片导出对话框');
  }

  return {
    dialog,
    triggerButton: root.getElementById('exportImageButton'),
    confirmPanel: findRequiredElement(dialog, '#imageExportConfirmPanel'),
    progressPanel: findRequiredElement(dialog, '#imageExportProgressPanel'),
    description: findRequiredElement(dialog, '#imageExportDialogDescription'),
    confirmNote: findRequiredElement(dialog, '#imageExportConfirmNote'),
    phase: findRequiredElement(dialog, '#imageExportPhase'),
    progress: findRequiredElement(dialog, '#imageExportProgress'),
    progressValue: findRequiredElement(dialog, '#imageExportProgressValue'),
    detail: findRequiredElement(dialog, '#imageExportDetail'),
    stats: findRequiredElement(dialog, '#imageExportStats'),
    startButton: findRequiredElement(dialog, '#startImageExportButton'),
    cancelButton: findRequiredElement(dialog, '#cancelImageExportButton')
  };
}

export function createImageExportDialog({
  dialog,
  triggerButton = null,
  onStart = () => {},
  onCancel = () => {}
} = {}) {
  if (!dialog) {
    throw new TypeError('createImageExportDialog 需要 dialog');
  }

  const elements = {
    dialog,
    triggerButton,
    confirmPanel: findRequiredElement(dialog, '#imageExportConfirmPanel'),
    progressPanel: findRequiredElement(dialog, '#imageExportProgressPanel'),
    description: findRequiredElement(dialog, '#imageExportDialogDescription'),
    confirmNote: findRequiredElement(dialog, '#imageExportConfirmNote'),
    phase: findRequiredElement(dialog, '#imageExportPhase'),
    progress: findRequiredElement(dialog, '#imageExportProgress'),
    progressValue: findRequiredElement(dialog, '#imageExportProgressValue'),
    detail: findRequiredElement(dialog, '#imageExportDetail'),
    stats: findRequiredElement(dialog, '#imageExportStats'),
    startButton: findRequiredElement(dialog, '#startImageExportButton'),
    cancelButton: findRequiredElement(dialog, '#cancelImageExportButton')
  };

  let currentState = 'closed';
  let cancelRequested = false;
  let returnFocus = null;

  function resetProgress() {
    elements.progress.removeAttribute('value');
    elements.progress.max = 1;
    elements.progressValue.textContent = '';
    elements.phase.textContent = PHASE_LABELS.analyzing;
    elements.detail.textContent = '正在准备导出…';
    elements.stats.textContent = '';
    elements.stats.hidden = true;
  }

  function setActionState({ showStart, canCancel, cancelText = '取消' }) {
    elements.startButton.hidden = !showStart;
    elements.startButton.disabled = !showStart;
    elements.cancelButton.disabled = !canCancel;
    elements.cancelButton.textContent = cancelText;
  }

  function openConfirm({ description, note } = {}) {
    currentState = 'confirm';
    cancelRequested = false;
    returnFocus = elements.triggerButton || dialog.ownerDocument?.activeElement || null;
    elements.confirmPanel.hidden = false;
    elements.progressPanel.hidden = true;
    elements.description.textContent = description
      || '导出将在确认后开始。内容较多时会自动生成多张 PNG，并打包为 ZIP。';
    elements.confirmNote.textContent = note
      || '每张图片最长约为两张竖版 A4；开始后可以随时取消。';
    resetProgress();
    setActionState({ showStart: true, canCancel: true });

    if (!dialog.open) {
      dialog.showModal();
    }
    elements.startButton.focus({ preventScroll: true });
  }

  function updateProgress(progressEvent = {}) {
    const phase = String(progressEvent.phase || 'preparing');

    if (cancelRequested && phase !== 'cancelling') {
      return;
    }

    const completed = normalizeCount(progressEvent.completed);
    const total = normalizeCount(progressEvent.total);
    const pageCount = normalizeCount(progressEvent.pageCount);
    const includedImages = normalizeCount(progressEvent.includedImages);
    const failedImages = normalizeCount(progressEvent.failedImages);
    const isSaving = ['saving', 'write'].includes(phase);
    const isCancelling = phase === 'cancelling';

    currentState = isSaving ? 'saving' : (isCancelling ? 'cancelling' : 'running');
    elements.confirmPanel.hidden = true;
    elements.progressPanel.hidden = false;
    elements.phase.textContent = PHASE_LABELS[phase] || String(progressEvent.label || '正在处理');

    if (total > 0) {
      elements.progress.max = total;
      elements.progress.value = Math.min(completed, total);
      elements.progressValue.textContent = `${Math.round((Math.min(completed, total) / total) * 100)}%`;
    } else {
      elements.progress.removeAttribute('value');
      elements.progressValue.textContent = '';
    }

    elements.detail.textContent = String(progressEvent.detail
      || formatProgressDetail({ phase, completed, total, pageCount }));

    const stats = formatStats({ pageCount, includedImages, failedImages });
    elements.stats.textContent = stats;
    elements.stats.hidden = stats.length === 0;

    if (isSaving) {
      setActionState({ showStart: false, canCancel: false, cancelText: '正在保存…' });
    } else if (isCancelling) {
      setActionState({ showStart: false, canCancel: false, cancelText: '正在取消…' });
    } else {
      setActionState({ showStart: false, canCancel: !cancelRequested });
    }
  }

  function showProgress(progressEvent = {}) {
    updateProgress({ phase: 'preparing', ...progressEvent });
  }

  function setCancelling(detail = '正在结束当前步骤并清理临时内容…') {
    if (!['running', 'cancelling'].includes(currentState)) {
      return;
    }
    cancelRequested = true;
    updateProgress({ phase: 'cancelling', detail });
  }

  function setSaving(detail = '正在写入文件，请稍候…') {
    updateProgress({ phase: 'saving', detail });
  }

  function close(result = '') {
    if (dialog.open) {
      dialog.close(result);
      return;
    }
    currentState = 'closed';
  }

  function requestCancel(reason) {
    if (cancelRequested || currentState === 'saving' || currentState === 'cancelling' || currentState === 'closed') {
      return;
    }

    const stateAtRequest = currentState;
    if (stateAtRequest === 'confirm') {
      close('cancel');
    } else {
      setCancelling();
    }
    onCancel({ reason, state: stateAtRequest });
  }

  function handleStart() {
    if (currentState !== 'confirm') {
      return;
    }
    showProgress({ phase: 'preparing', detail: '正在准备导出…' });
    onStart();
  }

  function handleCancelButton() {
    requestCancel('button');
  }

  function handleNativeCancel(event) {
    event.preventDefault();
    requestCancel('escape');
  }

  function handleBackdropClick(event) {
    if (event.target === dialog) {
      event.preventDefault();
    }
  }

  function handleClose() {
    currentState = 'closed';
    cancelRequested = false;
    const focusTarget = returnFocus;
    returnFocus = null;
    if (focusTarget?.isConnected) {
      focusTarget.focus({ preventScroll: true });
    }
  }

  elements.startButton.addEventListener('click', handleStart);
  elements.cancelButton.addEventListener('click', handleCancelButton);
  dialog.addEventListener('cancel', handleNativeCancel);
  dialog.addEventListener('click', handleBackdropClick);
  dialog.addEventListener('close', handleClose);

  return {
    openConfirm,
    showProgress,
    updateProgress,
    setCancelling,
    setSaving,
    close,
    requestCancel,
    destroy() {
      elements.startButton.removeEventListener('click', handleStart);
      elements.cancelButton.removeEventListener('click', handleCancelButton);
      dialog.removeEventListener('cancel', handleNativeCancel);
      dialog.removeEventListener('click', handleBackdropClick);
      dialog.removeEventListener('close', handleClose);
    },
    get state() {
      return currentState;
    }
  };
}

export { PHASE_LABELS as IMAGE_EXPORT_PHASE_LABELS };
