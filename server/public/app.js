(function () {
  const state = {
    projects: [],
    selected: new Set(),
    currentDetailId: null,
    currentDetail: null,
  };

  const $ = (sel) => document.querySelector(sel);

  function el(tag, opts = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(opts)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) node.appendChild(c);
    return node;
  }

  const MIN_IMAGES = 3;

  const STAGE_LABELS = {
    PENDING: 'Đang chờ...',
    DOWNLOADING: 'Đang tải...',
    VALIDATING: 'Đang kiểm tra...',
    IMAGE_PROCESSING: 'Đang xử lý ảnh...',
    ANALYZING: 'Đang gọi Claude viết kịch bản...',
    STORYBOARD_READY: 'Đã có kịch bản',
    TTS_GENERATING: 'Đang tạo giọng đọc...',
    RENDERING: 'Đang dựng video...',
    VALIDATING_OUTPUT: 'Đang kiểm tra video...',
    UPLOADING: 'Đang xuất bản...',
    DONE: 'Xong',
    FAILED: 'Lỗi',
  };

  function stageLabel(status) {
    return STAGE_LABELS[status] || 'Đang xử lý...';
  }

  // ---------- Toasts ----------
  function toast(type, message) {
    const container = $('#toast-container');
    const node = el('div', { class: `toast toast-${type}`, text: message });
    container.appendChild(node);
    setTimeout(() => node.remove(), 6000);
  }

  // ---------- API ----------
  async function api(path, opts = {}) {
    const res = await fetch(path, opts);
    let body = null;
    try {
      body = await res.json();
    } catch {
      // no JSON body (e.g. 204 No Content) - fine.
    }
    if (!res.ok) throw new Error((body && body.error) || `Lỗi ${res.status}`);
    return body;
  }

  /** Shows "<label>... Ns" on a button while an async action is pending. */
  async function withElapsedLabel(btn, label, fn) {
    btn.disabled = true;
    const startedAt = Date.now();
    btn.textContent = `${label}...`;
    const tick = setInterval(() => {
      btn.textContent = `${label}... ${Math.round((Date.now() - startedAt) / 1000)}s`;
    }, 1000);
    try {
      return await fn();
    } finally {
      clearInterval(tick);
      btn.disabled = false;
    }
  }

  // ---------- Project grid ----------
  async function loadProjects() {
    state.projects = await api('/api/projects');
    renderGrid();
  }

  const BADGE_LABEL = {
    NEW: 'Chưa có kịch bản',
    HAS_STORYBOARD: 'Đã có kịch bản',
    RUNNING: 'Đang chạy',
    DONE: 'Xong',
    FAILED: 'Lỗi',
  };

  function renderGrid() {
    const grid = $('#project-grid');
    grid.innerHTML = '';
    $('#empty-state').classList.toggle('hidden', state.projects.length > 0);

    for (const p of state.projects) {
      const card = el('div', { class: `project-card${state.selected.has(p.id) ? ' selected' : ''}` });

      const checkbox = el('input', { type: 'checkbox', class: 'card-checkbox' });
      checkbox.checked = state.selected.has(p.id);
      checkbox.addEventListener('click', (e) => e.stopPropagation());
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.selected.add(p.id);
        else state.selected.delete(p.id);
        card.classList.toggle('selected', checkbox.checked);
        renderBatchBar();
      });
      card.appendChild(checkbox);

      const thumb = el('div', { class: 'card-thumb' });
      if (p.thumbnailUrl) thumb.style.backgroundImage = `url(${p.thumbnailUrl})`;
      else thumb.textContent = p.imageCount > 0 ? `${p.imageCount} ảnh` : 'Chưa có ảnh';
      card.appendChild(thumb);

      const body = el('div', { class: 'card-body' });
      body.appendChild(el('div', { class: 'card-name', text: p.displayName }));
      const badgeText =
        p.badge === 'RUNNING' && p.stage ? stageLabel(p.status) : BADGE_LABEL[p.badge] || p.badge;
      body.appendChild(el('span', { class: `badge badge-${p.badge}`, text: badgeText }));
      if (p.badge === 'NEW' && !p.hasEnoughImages) {
        body.appendChild(
          el('div', { class: 'card-error', text: `Cần thêm ảnh (${p.imageCount}/${MIN_IMAGES})` }),
        );
      }
      if (p.errorMessage) body.appendChild(el('div', { class: 'card-error', text: p.errorMessage }));
      card.appendChild(body);

      card.addEventListener('click', () => openDetail(p.id));
      grid.appendChild(card);
    }
  }

  function renderBatchBar() {
    $('#batch-bar').classList.toggle('hidden', state.selected.size === 0);
    $('#batch-count').textContent = `Đã chọn ${state.selected.size}`;
  }

  // ---------- New project modal ----------
  $('#btn-new-project').addEventListener('click', () => {
    $('#new-project-name').value = '';
    $('#new-project-error').classList.add('hidden');
    $('#modal-new').classList.remove('hidden');
  });

  $('#btn-new-project-cancel').addEventListener('click', () => $('#modal-new').classList.add('hidden'));

  $('#btn-new-project-submit').addEventListener('click', async () => {
    const name = $('#new-project-name').value.trim();
    const errorBox = $('#new-project-error');
    errorBox.classList.add('hidden');
    if (!name) {
      errorBox.textContent = 'Nhập tên dự án';
      errorBox.classList.remove('hidden');
      return;
    }

    const submitBtn = $('#btn-new-project-submit');
    try {
      const created = await withElapsedLabel(submitBtn, 'Tạo dự án', () =>
        api('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        }),
      );
      $('#modal-new').classList.add('hidden');
      toast('success', `Đã tạo dự án "${name}" — giờ hãy tải ảnh lên`);
      await loadProjects();
      await openDetail(created.id);
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.remove('hidden');
    } finally {
      submitBtn.textContent = 'Tạo dự án';
    }
  });

  // ---------- Detail modal ----------
  async function openDetail(id) {
    state.currentDetailId = id;
    $('#modal-detail').classList.remove('hidden');
    await refreshDetail();
  }

  async function refreshDetail() {
    const id = state.currentDetailId;
    if (!id) return;

    let detail;
    try {
      detail = await api(`/api/projects/${id}`);
    } catch (err) {
      toast('error', err.message);
      return;
    }

    state.currentDetail = detail;

    $('#detail-title').textContent = detail.displayName;
    $('#detail-context').value = (detail.brief && detail.brief.context) || '';
    $('#detail-hook').value = (detail.brief && detail.brief.hook) || '';

    const errorBanner = $('#detail-error-banner');
    if (detail.badge === 'FAILED' && detail.errorMessage) {
      errorBanner.textContent = detail.errorMessage;
      errorBanner.classList.remove('hidden');
    } else {
      errorBanner.classList.add('hidden');
    }

    renderImagesSection(detail);
    renderStoryboardCurrent(detail.storyboard);
    renderStoryboardVersions(detail.versions || []);
    renderVideoSection(detail);
    renderGate(detail);

    $('#btn-generate-storyboard').textContent = detail.hasStoryboard ? 'Tạo lại kịch bản' : 'Tạo kịch bản';

    // A run this client didn't itself trigger (e.g. started from another tab,
    // or a batch run) still shows its live stage while the badge is RUNNING.
    if (detail.badge === 'RUNNING') showRunProgress(detail.status);
    else hideRunProgress();
  }

  function renderImagesSection(detail) {
    const grid = $('#detail-images-grid');
    grid.innerHTML = '';
    for (const filename of detail.previewFilenames || []) {
      grid.appendChild(el('img', { src: `/media/${detail.id}/preview/${filename}`, alt: filename }));
    }

    const countLabel = $('#detail-image-count');
    if (detail.hasEnoughImages) {
      countLabel.textContent = `${detail.imageCount} ảnh — sẵn sàng.`;
    } else {
      countLabel.textContent = `${detail.imageCount}/${MIN_IMAGES} ảnh — cần thêm ${MIN_IMAGES - detail.imageCount} ảnh để có thể tạo kịch bản/video.`;
    }
  }

  function renderGate(detail) {
    const ready = detail.hasEnoughImages && detail.badge !== 'RUNNING';
    $('#btn-suggest-brief').disabled = !ready;
    $('#btn-generate-storyboard').disabled = !ready;
    $('#brief-gate-hint').classList.toggle('hidden', detail.hasEnoughImages);
  }

  function renderStoryboardCurrent(storyboard) {
    const box = $('#storyboard-current');
    box.innerHTML = '';
    if (!storyboard) {
      box.textContent = 'Chưa có kịch bản.';
      return;
    }
    for (const scene of storyboard.scenes) {
      const line = el('div', { class: 'scene-line' });
      line.appendChild(el('span', { class: 'scene-type', text: scene.type }));
      line.appendChild(document.createTextNode(`${scene.headline} — ${scene.narration}`));
      box.appendChild(line);
    }
  }

  function renderStoryboardVersions(versions) {
    const box = $('#storyboard-versions');
    box.innerHTML = '';
    if (versions.length === 0) return;

    box.appendChild(el('div', { class: 'field', text: `${versions.length} phiên bản trước đó:` }));
    for (const v of versions) {
      const row = el('div', { class: 'version-row' });
      row.appendChild(el('span', { text: new Date(v.createdAt).toLocaleString('vi-VN') }));
      const btn = el('button', { class: 'btn btn-ghost', text: 'Dùng bản này' });
      btn.addEventListener('click', () => activateVersion(v.filename));
      row.appendChild(btn);
      box.appendChild(row);
    }
  }

  function renderVideoSection(detail) {
    const statusBox = $('#video-status');
    const btnGenerate = $('#btn-generate-video');
    const btnView = $('#btn-view-video');
    const btnRegenerate = $('#btn-regenerate-video');
    const progressWrap = $('#progress-wrap');

    btnGenerate.classList.add('hidden');
    btnView.classList.add('hidden');
    btnRegenerate.classList.add('hidden');
    progressWrap.classList.add('hidden');

    if (detail.badge === 'RUNNING') {
      statusBox.textContent = '';
      if (detail.status === 'RENDERING') progressWrap.classList.remove('hidden');
    } else if (detail.badge === 'DONE') {
      const dur = detail.durationSeconds ? `${detail.durationSeconds.toFixed(1)}s` : '?';
      statusBox.textContent = `Đã xong (${detail.scenes ?? '?'} cảnh, ${dur})`;
      btnView.classList.remove('hidden');
      btnRegenerate.classList.remove('hidden');
    } else if (!detail.hasStoryboard) {
      statusBox.textContent = 'Cần tạo kịch bản trước khi tạo video.';
    } else if (detail.badge === 'FAILED') {
      statusBox.textContent = 'Lần trước thất bại — có thể thử lại.';
      btnGenerate.classList.remove('hidden');
    } else {
      statusBox.textContent = 'Sẵn sàng tạo video.';
      btnGenerate.classList.remove('hidden');
    }
  }

  // ---------- Run progress (shared by storyboard + video generation) ----------
  function showRunProgress(status) {
    $('#run-progress').classList.remove('hidden');
    $('#run-stage-label').textContent = stageLabel(status);
  }

  function hideRunProgress() {
    $('#run-progress').classList.add('hidden');
    $('#progress-wrap').classList.add('hidden');
    $('#progress-fill').style.width = '0%';
  }

  $('#btn-detail-close').addEventListener('click', () => {
    $('#modal-detail').classList.add('hidden');
    state.currentDetailId = null;
    state.currentDetail = null;
    loadProjects();
  });

  $('#btn-detail-delete').addEventListener('click', async () => {
    const id = state.currentDetailId;
    if (!id || !confirm('Xoá dự án này? Không thể hoàn tác.')) return;
    try {
      await api(`/api/projects/${id}`, { method: 'DELETE' });
      toast('success', 'Đã xoá dự án');
      $('#modal-detail').classList.add('hidden');
      state.currentDetailId = null;
      state.currentDetail = null;
      await loadProjects();
    } catch (err) {
      toast('error', err.message);
    }
  });

  // ---------- Images ----------
  $('#btn-upload-images').addEventListener('click', async () => {
    const id = state.currentDetailId;
    const input = $('#detail-images-input');
    if (!input.files.length) return toast('error', 'Chọn ảnh trước đã');

    const formData = new FormData();
    for (const f of input.files) formData.append('images', f);

    const btn = $('#btn-upload-images');
    try {
      const result = await withElapsedLabel(btn, 'Đang tải ảnh lên', () =>
        api(`/api/projects/${id}/images`, { method: 'POST', body: formData }),
      );
      input.value = '';
      if (result.error) {
        toast('info', result.error);
      } else {
        toast('success', `Đã xử lý ${result.imageCount} ảnh`);
      }
      await refreshDetail();
    } catch (err) {
      toast('error', err.message);
    } finally {
      btn.textContent = 'Tải ảnh lên';
    }
  });

  $('#btn-save-brief').addEventListener('click', async () => {
    const id = state.currentDetailId;
    const context = $('#detail-context').value.trim();
    const hook = $('#detail-hook').value.trim();
    try {
      await api(`/api/projects/${id}/brief`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(context ? { context } : {}), ...(hook ? { hook } : {}) }),
      });
      toast('success', 'Đã lưu bối cảnh/hook');
    } catch (err) {
      toast('error', err.message);
    }
  });

  $('#btn-suggest-brief').addEventListener('click', async () => {
    const id = state.currentDetailId;
    const btn = $('#btn-suggest-brief');
    try {
      const suggestion = await withElapsedLabel(btn, 'Đang đọc ảnh', () =>
        api(`/api/projects/${id}/brief/suggest`, { method: 'POST' }),
      );
      if (suggestion) {
        $('#detail-context').value = suggestion.context || '';
        $('#detail-hook').value = suggestion.hook || '';
        toast('success', 'Đã gợi ý bối cảnh/hook từ ảnh');
      }
    } catch (err) {
      toast('error', err.message);
    } finally {
      btn.textContent = 'Gợi ý từ ảnh';
    }
  });

  $('#btn-generate-storyboard').addEventListener('click', async () => {
    const id = state.currentDetailId;
    const btn = $('#btn-generate-storyboard');
    btn.disabled = true;
    showRunProgress('VALIDATING');
    try {
      await api(`/api/projects/${id}/storyboard`, { method: 'POST' });
      toast('info', 'Đã bắt đầu tạo kịch bản...');
    } catch (err) {
      toast('error', err.message);
      hideRunProgress();
      btn.disabled = false;
    }
  });

  async function activateVersion(filename) {
    const id = state.currentDetailId;
    try {
      await api(`/api/projects/${id}/storyboard/versions/${encodeURIComponent(filename)}/activate`, {
        method: 'POST',
      });
      toast('success', 'Đã chuyển sang phiên bản này');
      await refreshDetail();
    } catch (err) {
      toast('error', err.message);
    }
  }

  $('#btn-generate-video').addEventListener('click', () => triggerGenerate(false));
  $('#btn-regenerate-video').addEventListener('click', () => triggerGenerate(true));

  async function triggerGenerate(force) {
    const id = state.currentDetailId;
    showRunProgress('VALIDATING');
    try {
      await api(`/api/projects/${id}/pipeline/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      toast('info', 'Đã bắt đầu tạo video...');
      await refreshDetail();
      await loadProjects();
    } catch (err) {
      toast('error', err.message);
      hideRunProgress();
    }
  }

  $('#btn-view-video').addEventListener('click', () => {
    $('#video-player').src = `/media/${state.currentDetailId}/video.mp4`;
    $('#modal-video').classList.remove('hidden');
  });

  $('#btn-video-close').addEventListener('click', () => {
    $('#modal-video').classList.add('hidden');
    const player = $('#video-player');
    player.pause();
    player.removeAttribute('src');
  });

  // ---------- Batch ----------
  document.querySelectorAll('input[name="batch-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const mode = document.querySelector('input[name="batch-mode"]:checked').value;
      $('#batch-concurrency-wrap').classList.toggle('hidden', mode !== 'parallel');
    });
  });

  $('#btn-batch-clear').addEventListener('click', () => {
    state.selected.clear();
    renderBatchBar();
    renderGrid();
  });

  $('#btn-batch-run').addEventListener('click', async () => {
    const mode = document.querySelector('input[name="batch-mode"]:checked').value;
    const concurrency = Number($('#batch-concurrency').value) || 2;
    const projectIds = Array.from(state.selected);
    try {
      await api('/api/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIds, mode, concurrency }),
      });
      toast('info', `Đã bắt đầu chạy ${projectIds.length} dự án (${mode === 'parallel' ? 'song song' : 'nối tiếp'})`);
      state.selected.clear();
      renderBatchBar();
      renderGrid();
    } catch (err) {
      toast('error', err.message);
    }
  });

  // ---------- SSE ----------
  function connectEvents() {
    const source = new EventSource('/api/events');

    source.addEventListener('update', (ev) => {
      const payload = JSON.parse(ev.data);
      if (payload.summary) {
        const idx = state.projects.findIndex((p) => p.id === payload.projectId);
        if (idx >= 0) state.projects[idx] = payload.summary;
        renderGrid();
      }
      if (state.currentDetailId !== payload.projectId) return;

      if (payload.summary) showRunProgress(payload.summary.status);
      if (payload.progress) {
        $('#progress-wrap').classList.remove('hidden');
        const { renderedFrames, totalFrames } = payload.progress;
        const pct = totalFrames ? Math.round((renderedFrames / totalFrames) * 100) : 0;
        $('#progress-fill').style.width = `${pct}%`;
        $('#progress-label').textContent = `${pct}%`;
      }
    });

    source.addEventListener('done', (ev) => {
      const payload = JSON.parse(ev.data);
      toast(payload.ok ? 'success' : 'error', `${payload.projectId}: ${payload.message}`);
      if (payload.summary) {
        const idx = state.projects.findIndex((p) => p.id === payload.projectId);
        if (idx >= 0) state.projects[idx] = payload.summary;
        renderGrid();
      }
      if (state.currentDetailId === payload.projectId) {
        hideRunProgress();
        refreshDetail();
      }
    });

    source.addEventListener('batch-done', (ev) => {
      const payload = JSON.parse(ev.data);
      toast('info', `Hàng loạt xong: ${payload.succeeded} thành công, ${payload.failed} lỗi`);
      loadProjects();
    });
  }

  loadProjects();
  connectEvents();
})();
