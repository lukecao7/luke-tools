import { apiFetch, configureReadingSpace, workspaceHeaders, uploadLimitMB } from "./reading-space.mjs";
import { indexPdfTextSpans, segmentDomRange, selectionFromPdfRange, pdfOffsetFromPoint, pdfSelectionPoint, pdfSelectionBetween, renderOcrTextLayer } from "./pdf-selection.mjs";
import { createPdfScrollSync } from "./pdf-scroll-sync.mjs";
import { highlightGroups, mergeHighlightRects, sourceFontSize } from "./pdf-highlights.mjs";
import { createReadingProgressStore } from "./reading-progress.mjs";
import { linkedTranslationRanges, projectAlignedRange } from "./document-translation.mjs";
import { translationUnit, sourceRangesForTranslation, createHighlightOutbox } from "./highlight-edits.mjs";
import { renderTranslatedFigure } from "./pdf-figures.mjs";
import { pageGraphicBounds, completeFigureRect, figurePaintRegions } from "./pdf-figure-layout.mjs";
import { translatedPullQuotes, layoutTranslationPage, pullQuoteRanges } from "./pdf-translation-layout.mjs";
import { processingDetails } from "./processing-progress.mjs";
import { digestStats, needsDigestRefinement } from "./evidence-digest.mjs";

import { bindPaneDivider, bindTocControls, readTocPreferences, setFocusVeil, closeDialogOnOutside } from "./reader-controls.mjs";
import { translationDisplayText, translationHeadingLabel, translationBlocks, translationFragments } from "./translation-presentation.mjs";
import { pdfMathBlocks, renderPdfMath } from "./pdf-math.mjs";
import { mountStyleExamples, examplesPending } from "./style-examples.mjs";

const app = document.querySelector("#app");
const toastNode = document.querySelector("#toast");

const state = {
  route: "home",
  taskId: null,
  task: null,
  tasks: [],
  tasksLoaded: false,
  importTab: "file",
  file: null,
  view: "compare",
  focusMode: false,
  paneRatio: .5,
  tocPreferences: readTocPreferences(localStorage, window.innerWidth),
  highlightPreview: null,
  summaryClock: null,
  selection: null,
  explanation: null,
  explainHistory: [],
  polling: null,
  importProgressTimer: null,
  importRun: null,
  cancellingTasks: new Set(),
  refiningHighlights: new Set(),
  pdfRenderToken: 0,
  pdfDocument: null,
  pdfScale: 1,
  pdfPageWidth: null,
  pdfScrollSync: null,
  pdfPosition: null,
  textPosition: null,
  textReady: false,
  readingTaskId: null,
  readingStatus: new Map(),
  pdfObserver: null,
  figureObserver: null,
  pdfJs: null,
  pendingFocus: null,
  currentParagraph: null,
  generating: new Set(),
  collapsedToc: new Set(),
  authenticated: false,
  authChecked: false,
  health: { online: false, provider: "codex", storage: "local" },
};

const readingStore = createReadingProgressStore({
  storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
  send: async (id, progress, { keepalive }) => {
    const response = await apiFetch(`/api/tasks/${id}/reading-progress`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(progress), keepalive,
    });
    if (!response.ok) throw new Error("阅读进度保存失败");
    return (await response.json()).readingProgress;
  },
  onChange: (id, progress, status) => {
    if (state.task?.id === id) state.task.readingProgress = progress;
    const listed = state.tasks.find(task => task.id === id);
    if (listed) listed.readingProgress = progress;
    state.readingStatus.set(id, status);
    if (state.taskId === id) {
      const label = document.querySelector("#reading-save-status");
      if (label) label.textContent = status;
    }
  },
});

const highlightOutbox = createHighlightOutbox({
  storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
  send: (id, updates) => api(`/api/tasks/${id}/highlights`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates }),
  }),
  onStatus: (id, status) => {
    if (status === 'storage-error') return toast('浏览器无法暂存高亮，请保持页面打开直到保存完成');
    if (state.taskId !== id) return;
    state.highlightSaveStatus = status;
    renderHighlightSaveStatus();
  },
});
function renderHighlightSaveStatus() {
  const reader = document.querySelector('.reader');
  if (!reader) return;
  let node = document.querySelector('#highlight-save-status');
  if (!node) { node = document.createElement('button'); node.id = 'highlight-save-status'; node.className = 'highlight-save-status'; reader.append(node); }
  const pending = highlightOutbox.hasPending(state.taskId);
  node.hidden = !pending;
  node.textContent = state.highlightSaveStatus === 'pending' ? '高亮已暂存 · 点击重试保存' : '正在保存高亮…';
  node.onclick = () => highlightOutbox.flush(state.taskId);
}
function commitHighlightUpdates(updates) {
  const task = state.task;
  for (const item of updates) task.paragraphs.find(p => p.id === item.paragraphId).highlights[item.side] = item.highlights;
  if (task.summary) task.summary.stale = true;
  state.selection = null; state.highlightPreview = null;
  window.getSelection()?.removeAllRanges();
  refreshHighlightDisplay(updates.map(item => item.paragraphId));
  highlightOutbox.enqueue(task.id, updates);
  return true;
}

const icons = {
  arrow: "←",
  chevron: "›",
  close: "×",
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  toastNode.textContent = message;
  toastNode.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastNode.classList.remove("show"), 2300);
}

async function api(url, options = {}) {
  const response = await apiFetch(url, options);
  if (!response.ok) {
    let message = `请求失败（${response.status}）`, code;
    try { const data=await response.json();message = data.error || message;code=data.code; } catch {}
    if (response.status === 401 && !code) {
      state.authenticated = false;
      renderLogin();
    }
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

function editionLabel() {
  return state.health.online ? "线上版" : "本地版";
}

function homeBrand(label = editionLabel()) {
  return `<a class="brand" href="/" data-home-link aria-label="长文伴读，返回首页"><span class="brand-mark" aria-hidden="true"></span><span>长文伴读</span><span class="local-pill">${label}</span></a>`;
}

app.addEventListener("click", event => {
  if (!event.target.closest("[data-home-link]") || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  go("home");
});

function aiLabel() {
  return "GPT 6.1 Sol";
}

function renderLogin(error = "") {
  app.innerHTML = `<main class="login-page"><section class="login-card">
    <div class="login-brand">${homeBrand("线上版")}</div>
    <span class="eyebrow">Private reading room</span>
    <h1>进入你的阅读空间</h1>
    <p>先输入网站访问密码。进入后，材料按浏览器隔离，内容由本地服务处理。</p>
    <form id="login-form"><label class="field-label" for="login-password">访问密码</label><input class="title-input" id="login-password" type="password" autocomplete="current-password" required autofocus />${error ? `<div class="login-error">${escapeHtml(error)}</div>` : ""}<button class="button primary login-submit">进入</button></form>
  </section></main>`;
  document.querySelector("#login-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    button.textContent = "正在验证…";
    const response = await apiFetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: document.querySelector("#login-password").value }) });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      renderLogin(payload.error || "访问密码不正确");
      return;
    }
    state.authenticated = true;
    render();
  };
}

async function boot() {
  try {
    const authResponse = await apiFetch("/api/auth/status");
    const auth = await authResponse.json();
    state.authChecked = true;
    state.authenticated = auth.authenticated;
    const healthResponse = await apiFetch("/api/health");
    if (healthResponse.ok) state.health = await healthResponse.json();
    configureReadingSpace(state.health);
    if (!state.authenticated) renderLogin(); else render();
  } catch {
    app.innerHTML = `<div class="loading-screen"><div class="loading-card"><h2>暂时无法连接服务</h2><p>请稍后刷新页面重试。</p></div></div>`;
  }
}

function go(route, taskId = null, replace = false) {
  if (state.route === "import" && route !== "import") state.importRun = null;
  stopImportProgress();
  preserveReaderPosition();
  readingStore.flush();
  if (route === "reader" && (state.route !== "reader" || taskId !== state.taskId)) state.task = null;
  state.route = route;
  state.taskId = taskId;
  state.selection = null;
  state.explanation = null;
  state.pendingFocus = null;
  stopPolling();
  const routeName = route === "reader" ? "read" : route;
  const url = route === "home" ? "/" : route === "import" ? "#/new" : `#/${routeName}/${taskId}`;
  history[replace ? "replaceState" : "pushState"]({}, "", url);
  render();
}

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (!parts.length) return { route: "home", id: null };
  if (parts[0] === "new") return { route: "import", id: null };
  if (["read", "summary"].includes(parts[0]) && parts[1]) return { route: parts[0] === "read" ? "reader" : "summary", id: parts[1] };
  return { route: "home", id: null };
}

function stopPolling() {
  if (state.polling) clearTimeout(state.polling);
  state.polling = null;
}

function stopImportProgress() {
  if (state.importProgressTimer) clearInterval(state.importProgressTimer);
  state.importProgressTimer = null;
}

async function loadTasks() {
  try {
    const data = await api("/api/tasks");
    state.tasks = data.tasks;
    state.tasksLoaded = true;
    state.tasks.forEach(task => readingStore.hydrate(task));
    if (state.route === "home") {
      renderHome();
      stopPolling();
      if (state.tasks.some(task => task.status === "processing")) state.polling = setTimeout(loadTasks, 1700);
    }
  } catch (error) {
    toast(error.message);
  }
}

async function loadTask(id, { quiet = false } = {}) {
  try {
    const data = await api(`/api/tasks/${id}`);
    if (id !== state.taskId) return;
    state.task = data.task;
    highlightOutbox.apply(state.task);
    const migration = canonicalizeLegacyHighlights(state.task);
    if (migration.length) highlightOutbox.enqueue(data.task.id, migration);
    else void highlightOutbox.flush(data.task.id);
    if (state.readingTaskId !== id || !document.querySelector(".reader")) restoreReadingState(data.task);
    if (state.route === "reader") renderReader();
    if (state.route === "summary") renderSummary();
    if (["processing"].includes(state.task.status)) {
      stopPolling();
      state.polling = setTimeout(() => loadTask(id, { quiet: true }), 1700);
    }
  } catch (error) {
    if (!quiet) toast(error.message);
  }
}

function statusLabel(task) {
  if (task.status === "processing") return "正在处理";
  if (task.status === "cancelled") return "已取消";
  if (task.status === "failed") return "处理失败";
  return task.summary ? "已有摘要" : "可以阅读";
}

function dateLabel(iso) {
  const date = new Date(iso);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function renderHome() {
  state.tasks.sort((a, b) => String(b.readingProgress?.updatedAt || b.updatedAt || "").localeCompare(String(a.readingProgress?.updatedAt || a.updatedAt || "")));
  app.innerHTML = `
    <main class="app-shell home-page">
      <header class="topbar"><div class="center-shell topbar-inner">
        ${homeBrand()}
        <div class="topbar-actions"></div>
      </div></header>
      <div class="center-shell home-content">
        <section class="hero">
          <div>
            <span class="eyebrow">你的阅读工作台</span>
            <h1>读懂长文，留下重点。</h1>
            <p>对照原文与译文，选出关键证据，再写成自己的摘要。</p>
          </div>
          <button class="button primary new-reading" id="new-task"><span aria-hidden="true">＋</span> 新建阅读</button>
        </section>
        <div class="home-workspace">
        <section class="reading-library" aria-labelledby="library-title">
        <div class="section-head"><h2 id="library-title">最近阅读 <span class="library-count">${state.tasksLoaded ? state.tasks.length : ""}</span></h2><span class="library-order">最近打开</span></div>
        <div class="task-list">
          ${state.tasks.length ? state.tasks.map((task) => `
            <a class="task-row" href="#/read/${task.id}" data-task-id="${task.id}">
              <span class="task-document" aria-hidden="true">${task.sourceType === "pdf" ? "PDF" : "TXT"}</span>
              <div class="task-info"><div class="task-title">${escapeHtml(task.title)}</div><div class="task-source">${escapeHtml(task.sourceName)}</div><div class="task-meta"><span class="status ${task.status}"><i class="status-dot"></i>${statusLabel(task)}</span><span>${dateLabel(task.readingProgress?.updatedAt || task.updatedAt)}</span></div></div>
              <div class="task-progress">${task.status === "processing" ? escapeHtml(processingDetails(task).compact) : task.readingProgress ? `<span>已读 ${task.readingProgress.percent}%</span><div class="task-reading-track"><span style="width:${task.readingProgress.percent}%"></span></div>` : `${task.pageCount || task.paragraphCount || "—"} ${task.pageCount ? "页" : "段"}`}</div>
              <span class="task-open" aria-hidden="true">${icons.chevron}</span>
            </a>`).join("") : !state.tasksLoaded ? `<div class="empty" role="status">正在读取你的阅读记录…</div>` : `<div class="empty"><strong>从第一篇长文开始</strong><p>上传 PDF、TXT、Markdown，或直接粘贴文字。<br>阅读进度和你留下的重点会自动保存。</p><button class="button" id="empty-new">添加阅读材料</button></div>`}
        </div>
        <p class="library-note">${state.health.online ? "阅读记录保存在此浏览器的专属空间，换浏览器不会同步。" : "材料与阅读记录保存在这台电脑。"}</p>
        </section>
        <aside class="home-style-panel"><span class="eyebrow">写出你的风格</span><section class="home-examples style-examples" id="home-examples"></section></aside>
        </div>
      </div>
    </main>`;
  mountStyleExamples(document.querySelector("#home-examples"));
  document.querySelector("#new-task").onclick = () => go("import");
  document.querySelector("#empty-new")?.addEventListener("click", () => go("import"));
  document.querySelectorAll(".task-row").forEach((row) => {
    row.onclick = event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); go("reader", row.dataset.taskId);
    };
  });
}

function renderImport() {
  const isFile = state.importTab === "file";
  app.innerHTML = `
    <main class="app-shell">
      <header class="topbar"><div class="center-shell topbar-inner">
        ${homeBrand()}
      </div></header>
      <div class="import-wrap">
        <button class="back-link" id="back-home">${icons.arrow} 返回阅读列表</button>
        <div class="import-heading"><h1>新建阅读</h1><p>识别 PDF 版面，通读全文后标出正文和图表中的关键证据。</p></div>
        <section class="import-card">
          <div class="tabs">
            <button class="tab ${isFile ? "active" : ""}" data-tab="file">上传文件</button>
            <button class="tab ${!isFile ? "active" : ""}" data-tab="paste">粘贴文字</button>
          </div>
          <form id="import-form" class="import-body">
            <label class="field-label" for="doc-title">材料名称（可选）</label>
            <input class="title-input" id="doc-title" name="title" placeholder="不填写时，自动取材料标题" />
            ${isFile ? `
              <input id="file-input" type="file" accept=".pdf,.txt,.md,.markdown,text/plain,application/pdf" hidden />
              <div class="dropzone" id="dropzone" tabindex="0">
                <div><div class="drop-icon"></div><strong>把文件拖到这里，或点击选择</strong><small>支持 PDF、TXT、Markdown，最大 ${uploadLimitMB()} MB</small></div>
              </div>
              ${state.file ? `<div class="selected-file">已选择：${escapeHtml(state.file.name)} · ${Math.max(1, Math.round(state.file.size / 1024))} KB</div>` : ""}
            ` : `
              <label class="field-label" for="paste-text">正文</label>
              <textarea class="paste-area" id="paste-text" name="text" placeholder="在这里粘贴中文或英文材料。你可以正常划选、复制和修改文字。"></textarea>
            `}
            <label class="privacy"><input id="privacy-check" type="checkbox" required /><span>我知道内容会发送给 ${aiLabel()} 处理。请不要导入不应发送给外部模型的敏感或涉密材料。</span></label>
            <div class="import-actions"><button class="button" type="button" id="cancel-import">取消</button><button class="button primary" id="submit-import" type="submit">开始阅读</button></div>
          </form>
        </section>
      </div>
    </main>`;

  document.querySelector("#back-home").onclick = () => go("home");
  document.querySelector("#cancel-import").onclick = () => state.importRun ? cancelImport() : go("home");
  document.querySelectorAll(".tab").forEach((tab) => tab.onclick = () => {
    state.importTab = tab.dataset.tab;
    state.file = null;
    renderImport();
  });
  if (isFile) setupDropzone();
  document.querySelector("#import-form").onsubmit = submitImport;
}

function setupDropzone() {
  const zone = document.querySelector("#dropzone");
  const input = document.querySelector("#file-input");
  const choose = () => { if (!state.importRun) input.click(); };
  zone.onclick = choose;
  zone.onkeydown = (event) => { if (["Enter", " "].includes(event.key)) choose(); };
  input.onchange = () => { state.file = input.files[0] || null; renderImport(); };
  zone.ondragover = (event) => { event.preventDefault(); zone.classList.add("drag"); };
  zone.ondragleave = () => zone.classList.remove("drag");
  zone.ondrop = (event) => {
    event.preventDefault();
    if (state.importRun) return;
    state.file = event.dataTransfer.files[0] || null;
    renderImport();
  };
}

async function submitImport(event) {
  event.preventDefault();
  if(state.file?.size>uploadLimitMB()*1024*1024)return toast(`文件不能超过 ${uploadLimitMB()} MB`);
  const button = document.querySelector("#submit-import");
  const form = new FormData(event.currentTarget);
  if (state.importTab === "file") {
    if (!state.file) return toast("请先选择一个文件");
    form.append("file", state.file);
  } else if (!String(form.get("text") || "").trim()) {
    return toast("请先粘贴正文");
  }
  button.disabled = true;
  button.textContent = "正在处理…";
  const run = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), controller: new AbortController(), cancelling: false };
  state.importRun = run;
  document.querySelector("#cancel-import").textContent = "取消处理";
  document.querySelectorAll('#import-form input, #import-form textarea, .tabs button').forEach(node => { node.disabled = true; });
  startImportProgress(state.file?.name || "粘贴内容");
  try {
    const data = await createTaskWithProgress(form, event => {
      if (state.importRun === run && !run.cancelling) updateImportProgress(event);
    }, run);
    if (run.cancelling || state.importRun !== run || state.route !== "import") return;
    stopImportProgress();
    state.task = data.task;
    highlightOutbox.apply(state.task);
    const migration = canonicalizeLegacyHighlights(state.task);
    if (migration.length) highlightOutbox.enqueue(data.task.id, migration);
    else void highlightOutbox.flush(data.task.id);
    go("reader", data.task.id);
  } catch (error) {
    if (run.cancelling || state.importRun !== run || state.route !== "import") return;
    stopImportProgress();
    toast(error.message);
    button.disabled = false;
    button.textContent = "开始阅读";
    document.querySelector("#cancel-import").disabled = false;
    document.querySelector("#cancel-import").textContent = "取消";
    document.querySelector("#import-progress")?.remove();
    document.querySelectorAll('#import-form input, #import-form textarea, .tabs button').forEach(node => { node.disabled = false; });
  } finally {
    if (state.importRun === run && !run.cancelling) state.importRun = null;
  }
}

async function cancelImport() {
  const run = state.importRun;
  if (!run || run.cancelling) return;
  run.cancelling = true;
  const button = document.querySelector("#cancel-import");
  button.disabled = true; button.textContent = "正在取消…";
  run.controller.abort();
  try {
    const data = await api(`/api/tasks/${run.id}/cancel`, { method: "POST" });
    if (state.importRun !== run) return;
    state.importRun = null;
    stopImportProgress();
    if (state.route !== "import") return;
    if (data.task) { state.task = data.task;
    highlightOutbox.apply(state.task);
    const migration = canonicalizeLegacyHighlights(state.task);
    if (migration.length) highlightOutbox.enqueue(data.task.id, migration);
    else void highlightOutbox.flush(data.task.id); go("reader", data.task.id); return; }
    document.querySelector("#import-progress").innerHTML = '<strong>已取消处理</strong><p class="processing-note">文件仍保留在这里，可以重新开始。</p>';
    button.disabled = false; button.textContent = "返回列表";
    const submit = document.querySelector("#submit-import"); submit.disabled = false; submit.textContent = "重新开始";
    document.querySelectorAll('#import-form input, #import-form textarea, .tabs button').forEach(node => { node.disabled = false; });
  } catch (error) {
    run.cancelling = false;
    if (button.isConnected) { button.disabled = false; button.textContent = "重试取消"; }
    toast(`未能确认取消：${error.message}`);
  }
}

async function cancelTaskProcessing(id) {
  if (state.cancellingTasks.has(id)) return;
  state.cancellingTasks.add(id);
  renderReader();
  try {
    const data = await api(`/api/tasks/${id}/cancel`, { method: "POST" });
    if (state.taskId === id) { state.task = data.task;
    highlightOutbox.apply(state.task);
    const migration = canonicalizeLegacyHighlights(state.task);
    if (migration.length) highlightOutbox.enqueue(id, migration);
    else void highlightOutbox.flush(id); stopPolling(); renderReader(); }
  } catch (error) { toast(`未能确认取消：${error.message}`); }
  finally { state.cancellingTasks.delete(id); if (state.taskId === id && state.route === "reader") renderReader(); }
}

function formatElapsed(seconds) {
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
}

function startImportProgress(sourceName) {
  stopImportProgress();
  const actions = document.querySelector(".import-actions");
  document.querySelector("#import-progress")?.remove();
  actions.insertAdjacentHTML("beforebegin", `
    <section class="import-progress" id="import-progress" role="status" aria-label="${escapeHtml(sourceName)}的处理进度" aria-live="polite">${processingMeterMarkup({ processingStage: "recognition", processingStartedAt: state.importRun?.startedAt || new Date().toISOString() })}</section>`);
  startProcessingClock();
}

function processingMeterMarkup(progress) {
  const p = processingDetails(progress);
  return `<div class="import-progress-head"><strong id="import-progress-stage">${p.title}</strong><span id="import-progress-value">${p.value}</span></div>
    <ol class="processing-steps" aria-label="处理阶段">${p.steps.map((label, index) => `<li class="${index < p.stageIndex ? "done" : index === p.stageIndex ? "active" : ""}" ${index === p.stageIndex ? 'aria-current="step"' : ""}><i aria-hidden="true">${index < p.stageIndex ? "✓" : index === p.stageIndex ? "" : index + 1}</i><span>${label}</span></li>`).join("")}</ol>
    <div class="import-progress-meta"><span id="import-progress-count">${p.detail}</span><span id="import-progress-time" aria-live="off" data-processing-started="${escapeHtml(p.startedAt || "")}" data-time-label="${p.timeLabel}"></span></div>`;
}

function startProcessingClock() {
  stopImportProgress();
  const tick = () => document.querySelectorAll("[data-processing-started]").forEach(node => {
    const startedAt = Date.parse(node.dataset.processingStarted);
    node.textContent = Number.isFinite(startedAt) ? `${node.dataset.timeLabel} ${formatElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))}` : "";
  });
  tick();
  state.importProgressTimer = setInterval(tick, 1000);
}

function updateImportProgress(event) {
  const container = document.querySelector("#import-progress");
  const progress = event.type === "created" ? event.task : event.type === "progress" ? event.progress : null;
  if (!container || !progress) return;
  container.innerHTML = processingMeterMarkup(progress);
  startProcessingClock();
}

async function createTaskWithProgress(form, onEvent, run) {
  const response = await apiFetch("/api/tasks", {
    method: "POST",
    headers: { Accept: "application/x-ndjson", "X-Task-Id": run.id, "X-Processing-Started-At": run.startedAt },
    body: form,
    signal: run.controller.signal,
  });
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  if (!response.body) return response.json();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let createdTask = null;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "error") throw new Error(event.error || "处理失败");
      if (event.type === "failed" && event.task) return { task: event.task };
      if (event.type === "cancelled") throw new Error("处理已取消，已完成的内容保留在阅读列表中");
      if (event.type === "created") createdTask = event.task;
      onEvent(event);
      if (event.type === "done") return { task: event.task };
    }
    if (done) break;
  }
  if (createdTask) return waitForTaskReady(createdTask.id, onEvent, run.controller.signal);
  throw new Error("处理连接提前结束，请重试");
}

async function waitForTaskReady(id, onEvent, signal) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15 * 60 * 1000) {
    signal.throwIfAborted();
    const data = await api(`/api/tasks/${id}`);
    const task = data.task;
    onEvent({ type: "progress", progress: task });
    if (task.status === "ready") return { task };
    if (task.status === "failed") return { task };
    if (task.status === "cancelled") throw new Error("处理已取消，已完成的内容保留在阅读列表中");
    await new Promise((resolve) => setTimeout(resolve, 1400));
  }
  throw new Error("处理时间过长，请返回阅读列表查看进度");
}

function normalizedRanges(ranges, length) {
  return [...(ranges || [])]
    .map((range) => ({ ...range, start: Math.max(0, range.start), end: Math.min(length, range.end) }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function richText(text, ranges, paragraphId, side, offsetBase = 0) {
  const localRanges = (ranges || []).map((range) => ({
    ...range,
    start: range.start - offsetBase,
    end: range.end - offsetBase,
  }));
  const safeRanges = normalizedRanges(localRanges, text.length);
  let html = "";
  let cursor = 0;
  for (const range of safeRanges) {
    if (range.start < cursor) continue;
    html += escapeHtml(text.slice(cursor, range.start));
    html += `<mark class="highlight" data-highlight-id="${escapeHtml(range.id)}" data-paragraph-id="${paragraphId}" data-side="${side}" data-start="${range.start + offsetBase}" data-end="${range.end + offsetBase}"><button class="range-handle start" data-boundary="start" aria-label="拖动高亮起点"></button>${escapeHtml(text.slice(range.start, range.end))}<button class="range-handle end" data-boundary="end" aria-label="拖动高亮终点"></button><button class="highlight-delete" aria-label="删除高亮" title="删除高亮"></button></mark>`;
    cursor = range.end;
  }
  return html + escapeHtml(text.slice(cursor));
}

function readerProgressLabel(task, readingPercent = 0) {
  if (task.sourceType === "pdf" && task.pageCount) {
    const page = Math.max(1, Math.min(task.pageCount, Math.round((readingPercent / 100) * task.pageCount) || 1));
    return `${page} / ${task.pageCount} 页`;
  }
  const currentIndex = Math.max(1, task.paragraphs.findIndex((p) => p.id === state.currentParagraph) + 1);
  return `${currentIndex} / ${task.paragraphs.length} 段`;
}

function paragraphCell(paragraph, side) {
  const text = paragraph[side] || "";
  if (!text && paragraph.status !== "done") {
    return `<div class="paragraph-cell ${side}-cell" data-side="${side}"><p class="paragraph-text"><span class="processing-line"></span></p></div>`;
  }
  return `<div class="paragraph-cell ${side}-cell" data-side="${side}"><p class="paragraph-text" data-paragraph-id="${paragraph.id}" data-side="${side}">${richText(text, paragraph.highlights?.[side], paragraph.id, side)}</p></div>`;
}

function tocLabel(item) {
  return translationHeadingLabel(item).replace(/\s+/g, " ").trim();
}

function tocKey(value) {
  return String(value || "").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function inferTocTranslation(task, original, pdfPage) {
  const common = new Map([
    ["executivesummary", "执行摘要"],
    ["introduction", "引言"],
    ["conclusion", "结论"],
    ["methodology", "研究方法"],
    ["respondentprofile", "受访者概况"],
  ]);
  const key = tocKey(original);
  if (common.has(key)) return common.get(key);
  const exact = task.paragraphs.find((paragraph) => tocKey(paragraph.original) === key && paragraph.translation?.trim());
  if (exact) return exact.translation.trim();
  const prefixed = task.paragraphs.find((paragraph) => paragraph.pageNumber === pdfPage
    && tocKey(paragraph.original).startsWith(key)
    && paragraph.translation?.trim());
  if (prefixed) {
    const translation = prefixed.translation.trim();
    const firstBreak = translation.search(/[\s：:]/);
    if (firstBreak > 1) return translation.slice(0, firstBreak);
  }
  const combined = task.paragraphs.find((paragraph) => paragraph.sourceSegments?.some((segment) => tocKey(segment.text) === key)
    && paragraph.translation?.trim());
  if (combined) {
    const segments = combined.sourceSegments.filter((segment) => segment.text?.trim());
    const index = segments.findIndex((segment) => tocKey(segment.text) === key);
    const parts = combined.translation.split(/[：:]/).map((part) => part.trim()).filter(Boolean);
    if (parts[index]) return parts[index];
  }
  return original;
}

function extractedPdfTocItems(task) {
  if (task.sourceType !== "pdf") return [];
  const marker = task.paragraphs.find((paragraph) => /^(table of contents|contents)$/i.test(String(paragraph.original || "").trim()));
  if (!marker?.pageNumber) return [];
  const pageParagraphs = task.paragraphs.filter((paragraph) => paragraph.pageNumber === marker.pageNumber);
  const numericRows = pageParagraphs.flatMap((paragraph) => (paragraph.sourceSegments || []).map((segment) => ({
    text: String(segment.text || "").trim(),
    rect: segment.rect,
  }))).filter((item) => /^\d{1,3}$/.test(item.text)
    && item.rect
    && item.rect.left < 0.13
    && item.rect.top > 0.12
    && item.rect.top < 0.93);
  if (numericRows.length < 3) return [];
  const footerNumber = pageParagraphs.flatMap((paragraph) => paragraph.sourceSegments || [])
    .find((segment) => /^\d{1,3}$/.test(String(segment.text || "").trim()) && segment.rect?.top > 0.94);
  const printedTocPage = Number(footerNumber?.text);
  const pageOffset = Number.isFinite(printedTocPage) ? marker.pageNumber - printedTocPage : 0;
  const textRows = pageParagraphs.flatMap((paragraph) => (paragraph.sourceSegments || []).map((segment) => ({
    text: String(segment.text || "").replace(/\s+/g, " ").trim(),
    rect: segment.rect,
  }))).filter((item) => item.text
    && item.rect
    && item.rect.left >= 0.13
    && item.rect.top > 0.12
    && item.rect.top < 0.93
    && !/^(table of contents|contents)$/i.test(item.text));
  const paired = textRows.map((item) => {
    const page = [...numericRows].sort((a, b) => Math.abs(a.rect.top - item.rect.top) - Math.abs(b.rect.top - item.rect.top))[0];
    if (!page || Math.abs(page.rect.top - item.rect.top) > 0.012) return null;
    return { ...item, displayPage: Number(page.text) };
  }).filter(Boolean).sort((a, b) => a.rect.top - b.rect.top);
  if (paired.length < 3) return [];
  const maxHeight = Math.max(...paired.map((item) => item.rect.height || 0));
  const seen = new Set();
  return paired.map((item, index) => {
    const key = `${item.displayPage}-${tocKey(item.text)}`;
    if (!tocKey(item.text) || seen.has(key)) return null;
    seen.add(key);
    const actualPage = Math.max(1, Math.min(task.pageCount || item.displayPage, item.displayPage + pageOffset));
    return {
      id: `pdf-toc-${marker.pageNumber}-${index}`,
      original: item.text,
      translation: inferTocTranslation(task, item.text, actualPage),
      headingLevel: (item.rect.height || 0) >= maxHeight * 0.9 ? 1 : 2,
      pageNumber: actualPage,
      displayPage: item.displayPage,
      source: "pdf-toc",
    };
  }).filter(Boolean);
}

function heuristicTocItems(task) {
  const candidates = task.paragraphs.filter((item) => item.headingLevel > 0 && item.translationVisible !== false);
  const countsByPage = new Map();
  for (const item of candidates) countsByPage.set(item.pageNumber, (countsByPage.get(item.pageNumber) || 0) + 1);
  const seen = new Set();
  return candidates.filter((item) => {
    const original = String(item.original || "").replace(/\s+/g, " ").trim();
    const label = tocLabel(item);
    if (!label || label.length < 2 || label.length > 90) return false;
    if (/[?？]$/.test(original) || /[?？]$/.test(label)) return false;
    if (/^[“”'\"‘’]/.test(original) || /^[“”'\"‘’·•\-–—\s]+$/.test(original)) return false;
    if (/^(author|editor|design|contributors?|with contributions from|copyright|table of contents|contents|about the\b|respondent profile\b)/i.test(original)) return false;
    if ((countsByPage.get(item.pageNumber) || 0) >= 5 && item.pageNumber <= 5) return false;
    const key = label.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 60);
}

function readerTocItems(task) {
  const extracted = extractedPdfTocItems(task);
  return extracted.length >= 3 ? extracted : heuristicTocItems(task);
}

function tocMarkup(items) {
  const hiddenLevels = [];
  return items.map((item, index) => {
    while (hiddenLevels.length && hiddenLevels.at(-1).level >= item.headingLevel) hiddenLevels.pop();
    const hidden = hiddenLevels.length > 0;
    const next = items[index + 1];
    const hasChildren = Boolean(next && next.headingLevel > item.headingLevel);
    const collapsed = state.collapsedToc.has(item.id);
    const markup = `<div class="toc-line level-${item.headingLevel}" ${hidden ? "hidden" : ""}><button class="toc-item level-${item.headingLevel}" data-jump="${item.id}" data-page="${item.pageNumber || ""}"><span>${escapeHtml(tocLabel(item))}</span>${item.pageNumber ? `<small>${item.displayPage || item.pageNumber}</small>` : ""}</button>${hasChildren ? `<button class="toc-toggle ${collapsed ? "collapsed" : ""}" data-toc-toggle="${item.id}" aria-label="${collapsed ? "展开" : "收起"}下级目录">⌄</button>` : ""}</div>`;
    if (collapsed || hidden) hiddenLevels.push({ level: item.headingLevel, id: item.id });
    return markup;
  }).join("");
}

function translationParagraphMarkup(paragraph, pageTocItems, fragment) {
  const text = translationDisplayText(paragraph);
  const ranges = paragraph.highlights.translation || [];
  const matchedToc = pageTocItems.find((item) => tocKey(paragraph.original).startsWith(tocKey(item.original))
    || text.startsWith(tocLabel(item)));
  const title = matchedToc ? translationDisplayText(matchedToc).trim() : "";
  const standaloneHeading = paragraph.headingLevel > 0 && text.trim() === title;
  const inferredHeading = fragment?.start ? 0 : paragraph.headingLevel || (matchedToc && text.trim() === title ? matchedToc.headingLevel : 0)
    || (paragraph.roleHint === 'candidate' && paragraph.original.length < 100 && /^\d+(?:\.\d+)+\.?\s+[A-Za-z]/.test(paragraph.original) ? 2 : 0);
  const formattedRange = (start, end) => {
    const number = text.slice(start, end).match(/^(\d+(?:\.\d+)*\.?|[A-Z](?:\.\d+)*\.)(?=[^\s\d.])/)?.[0];
    const render = (from, to) => richText(text.slice(from, to), ranges, paragraph.id, "translation", from);
    return number && inferredHeading ? `<span class="translation-section-number">${render(start, start + number.length)}</span>${render(start + number.length, end)}` : render(start, end);
  };
  const structuredContent = (from = 0) => translationBlocks(paragraph, state.task).filter(block => block.end > from).map(block => ({ ...block, start: Math.max(from, block.start) })).map(block => `<span class="translation-block${block.listItem ? ' translation-list-item' : ''}">${block.leadEnd && block.leadEnd > block.start
    ? `<strong class="translation-run-in">${formattedRange(block.start, block.leadEnd)}</strong>${formattedRange(block.leadEnd, block.end)}`
    : formattedRange(block.start, block.end)}</span>`).join("");
  let content = structuredContent();
  let classes = inferredHeading ? `is-heading level-${inferredHeading}` : "";
  if (fragment) {
    const leadEnd = fragment.leadEnd;
    content = leadEnd ? `<strong class="translation-run-in">${formattedRange(fragment.start, leadEnd)}</strong>${formattedRange(leadEnd, fragment.end)}` : formattedRange(fragment.start, fragment.end);
    if (fragment.listItem && !inferredHeading) classes += ' is-source-list';
  }
  if ((!fragment || fragment.start === 0) && title && text.startsWith(title) && text.length > title.length && (!fragment || fragment.end > title.length)) {
    content = `<span class="translation-section-title level-${matchedToc.headingLevel}">${formattedRange(0, title.length)}</span><span class="translation-body-text">${fragment ? formattedRange(title.length, fragment.end) : structuredContent(title.length)}</span>`;
    classes = 'has-section-title';
  } else if (!title) {
    if (/^\s*•/.test(text)) {
      classes = `${classes} is-bullet`.trim();
    }
  }
  if (paragraph.pullQuote) classes += " is-pull-quote";
  if (standaloneHeading) classes = `${classes} standalone-heading`.trim();
  const id = fragment?.start ? `${paragraph.id}-at-${fragment.start}` : paragraph.id;
  return `<div id="${id}" class="pdf-translation-paragraph ${classes}"${fragment ? ` data-source-paragraph="${fragment.sourceParagraphId}" data-source-rect='${JSON.stringify(fragment.rect)}' data-source-indent="${fragment.indent}"` : ''}><p class="paragraph-text" data-paragraph-id="${paragraph.id}" data-side="translation" data-text-start="${fragment?.start || 0}" data-text-end="${fragment?.end ?? text.length}">${content}</p></div>`;
}

function pdfTranslationMarkup(task) {
  state.pullQuotes = translatedPullQuotes(task);
  state.mathBlocks = pdfMathBlocks(task);
  const mathIds = new Set(state.mathBlocks.flatMap(b => b.paragraphIds));
  state.translationFragments = new Map();
  for (const paragraph of [...task.paragraphs, ...state.pullQuotes]) {
    if (paragraph.translationVisible === false && !paragraph.pullQuote || paragraph.figureId || paragraph.translationContinuationOf) continue;
    state.translationFragments.set(paragraph.id, translationFragments(paragraph, task, { mathIds }));
  }
  const tocItems = readerTocItems(task);
  const tocMarker = task.paragraphs.find((paragraph) => /^(table of contents|contents)$/i.test(String(paragraph.original || "").trim()));
  return Array.from({ length: task.pageCount || 1 }, (_, index) => {
    const pageNumber = index + 1;
    const paragraphs = [...task.paragraphs, ...state.pullQuotes].filter((paragraph) => {
      if (!state.translationFragments.get(paragraph.id)?.some(f => f.pageNumber === pageNumber)) return false;
      const original = String(paragraph.original || "").trim();
      const translation = String(paragraph.translation || "").trim();
      if (paragraph.headingLevel > 0 && (/^[“”'\"‘’]/.test(original) || /^[\p{P}\p{S}\s]+$/u.test(translation))) return false;
      return true;
    });
    const pageTocItems = tocItems.filter((item) => item.pageNumber === pageNumber);
    const insertedTitles = pageTocItems.filter(item => !paragraphs.some(p => tocKey(p.original).startsWith(tocKey(item.original)) || String(p.translation || "").startsWith(tocLabel(item)))).map(item => {
      const source = task.paragraphs.find(p => p.pageNumber === pageNumber && tocKey(p.original) === tocKey(item.original));
      return source ? `<h2 class="translation-inserted-title level-${item.headingLevel}" data-source-paragraph="${source.id}" data-source-title="${escapeHtml(source.original)}">${escapeHtml(tocLabel(item))}</h2>` : "";
    }).join("");
    const isTocPage = tocMarker?.pageNumber === pageNumber;
    const figures = (task.figures || []).filter(f => f.pageNumber === pageNumber).map(f => `<figure class="translated-figure" data-figure-id="${f.id}"><div class="figure-loading">正在加载中文图表…</div><div class="figure-labels"></div></figure>`).join("");
    const formulas = state.mathBlocks.filter(b => b.pageNumber === pageNumber).map(b => `<figure class="pdf-math" data-math-id="${b.id}" aria-label="原文公式及编号"><span class="formula-loading">正在加载公式…</span></figure>`).join('');
    return `<section class="pdf-translation-page" id="translation-page-${pageNumber}" data-page-number="${pageNumber}">
      <div class="pdf-page-label">PDF · ${pageNumber}</div>
      ${isTocPage
        ? `<div class="pdf-page-empty is-navigation"><strong>本页为原文目录</strong><span>中文目录已经整理在左侧，点击即可跳转。</span></div>`
        : `<div class="pdf-layout-content">${insertedTitles}${paragraphs.length ? paragraphs.flatMap(paragraph => state.translationFragments.get(paragraph.id).filter(f => f.pageNumber === pageNumber).map(f => translationParagraphMarkup(paragraph, pageTocItems, f))).join("") : figures || formulas ? "" : `<p class="pdf-page-empty">本页没有正文内容。</p>`}${figures}${formulas}</div>`}
    </section>`;
  }).join("");
}

function readingZoomMarkup(original = false) {
  return `<div class="pdf-tools" aria-label="两侧同步缩放"><button ${original ? 'id="pdf-zoom-out"' : ''} data-reading-zoom="-1" aria-label="缩小原文和译文">−</button><span ${original ? 'id="pdf-zoom-value"' : ''} data-reading-zoom-value title="原文和译文同步缩放">同步 · ${Math.round(state.pdfScale * 100)}%</span><button ${original ? 'id="pdf-zoom-in"' : ''} data-reading-zoom="1" aria-label="放大原文和译文">＋</button></div>`;
}

function pdfReaderMarkup(task, viewClass, failed) {
  return `<section class="reading-area pdf-reading-area ${viewClass}" id="reading-area">
    ${failed ? `<div class="failure-banner"><div><strong>AI 处理没有完成</strong><span>${escapeHtml(task.error || "请稍后重试")}</span></div><button class="button" id="retry-task">${task.documentAnalyzed ? "继续翻译" : "继续处理"}</button></div>` : ""}
    <div class="pdf-reader-columns">
      <section class="pdf-pane">
        <div class="pdf-pane-head"><strong>原 PDF</strong>${readingZoomMarkup(true)}</div>
        <div class="pdf-scroll" id="pdf-scroll"><div class="pdf-pages" id="pdf-pages"><div class="pdf-loading">正在打开原 PDF…</div></div></div>
      </section>
      <section class="pdf-translation-pane">
        <div class="pdf-pane-head"><strong>中文翻译</strong>${readingZoomMarkup()}</div>
        <div class="pdf-translation-scroll" id="pdf-translation-scroll">${pdfTranslationMarkup(task)}</div>
      </section>
    </div>
    <div class="pane-divider" id="pane-divider" role="separator" tabindex="0" aria-label="调整原文和译文宽度，双击恢复等宽" aria-orientation="vertical" aria-valuemin="25" aria-valuemax="75" aria-valuenow="50"></div>
    <div class="scroll-progress"><div class="scroll-thumb" id="scroll-thumb"></div></div>
  </section>`;
}

function renderReaderProcessing(task) {
  const cancelled = task.status === "cancelled";
  const cancelling = state.cancellingTasks.has(task.id);
  app.innerHTML = `<main class="processing-page">
    <header class="topbar"><div class="center-shell topbar-inner">${homeBrand()}<button class="button" id="processing-back">返回阅读列表</button></div></header>
    <section class="processing-shell">
      <span class="eyebrow">${cancelled ? "处理已停止" : "正在准备阅读材料"}</span>
      <h1>${escapeHtml(task.title)}</h1>
      <p class="processing-lead">${cancelled ? "已完成的内容已保留，可以从中断处继续。" : "正在为这份材料整理重点和中文译文。"}</p>
      <div class="processing-meter ${cancelled ? "is-cancelled" : ""}">${processingMeterMarkup(task)}</div>
      <div class="processing-actions">${cancelled ? '<button class="button primary" id="retry-task">继续处理</button>' : `<button class="button" id="cancel-processing" ${cancelling ? "disabled" : ""}>${cancelling ? "正在取消…" : "取消处理"}</button>`}</div>
      <p class="processing-note">${cancelled ? "继续处理会复用已完成的结果。" : "完成后会自动打开；也可以先返回列表。取消会停止当前处理并保留已完成的内容。"}</p>
    </section>
  </main>`;
  document.querySelector("#processing-back").onclick = () => go("home");
  if (cancelled) { document.querySelector("#retry-task").onclick = retryTask; stopPolling(); }
  else {
    document.querySelector("#cancel-processing").onclick = () => cancelTaskProcessing(task.id);
    startProcessingClock();
    if (!state.polling) state.polling = setTimeout(() => loadTask(task.id, { quiet: true }), 1200);
  }
}

function digestNotice(task) {
  if (task.status !== "ready" || !needsDigestRefinement(task)) return "";
  const busy = state.refiningHighlights.has(task.id);
  const coverageRepair = task.highlightDigest?.version === 1;
  return `<div class="digest-notice" id="digest-notice"><strong>${coverageRepair ? "推荐重点待优化" : "AI 推荐范围偏大"}</strong><p id="digest-detail">${busy ? "正在精简推荐，原有重点会保留到完成。" : coverageRepair ? "重新核对全文主题，避免遗漏后半篇的关键内容。" : `当前覆盖正文约 ${Math.round(digestStats(task).ratio*100)}%，可精简至约四分之一。`}</p><button class="button" id="refine-highlights">${busy ? "取消筛选" : "精简推荐重点"}</button><small>复用现有译文，保留手动重点。</small></div>`;
}

async function refineHighlights() {
  const task=state.task, button=document.querySelector('#refine-highlights');
  if(state.refiningHighlights.has(task.id)) {
    button.disabled=true;button.textContent='正在取消…';
    try { await api(`/api/tasks/${task.id}/cancel`,{method:'POST'}); }
    catch(error) { toast(error.message); button.disabled=false; }
    return;
  }
  state.refiningHighlights.add(task.id); button.textContent='取消筛选';
  document.querySelector('#digest-detail').textContent='正在精简推荐，原有重点会保留到完成。';
  try {
    const {task:updated}=await api(`/api/tasks/${task.id}/refine-highlights`,{method:'POST'});
    if(state.taskId!==task.id || state.route!=='reader')return;
    state.task=updated;state.selection=null;state.highlightPreview=null;
    refreshHighlightDisplay(updated.paragraphs.map(p=>p.id));
    document.querySelector('#digest-notice')?.remove();
    toast(`已精简为正文的 ${Math.round(digestStats(updated).ratio*100)}%，手动重点已保留`);
  } catch(error) { toast(error.message); }
  finally {
    state.refiningHighlights.delete(task.id);
    const active=document.querySelector('#refine-highlights');
    if(state.taskId===task.id && active) { active.disabled=false;active.textContent='精简推荐重点';document.querySelector('#digest-detail').textContent='原有重点已保留，可再次精简。'; }
  }
}

function renderReader() {
  stopImportProgress();
  preserveReaderPosition();
  const task = state.task;
  if (!task || task.id !== state.taskId) {
    app.innerHTML = `<div class="loading-screen"><div class="loading-card"><h2>打开材料</h2><p>正在读取本地内容…</p><div class="loading-bar"><span style="width:22%"></span></div></div></div>`;
    loadTask(state.taskId);
    return;
  }
  const processing = task.status === "processing";
  if (processing || task.status === "cancelled") {
    renderReaderProcessing(task);
    return;
  }
  if (state.readingTaskId !== task.id) restoreReadingState(task);
  const tocItems = readerTocItems(task);
  const failed = task.status === "failed";
  const pdfMode = task.sourceType === "pdf" && task.sourceAvailable;
  if (!pdfMode) state.pullQuotes = [];
  const viewClass = state.view === "original" ? "single-original" : state.view === "translation" ? "single-translation" : "";
  app.innerHTML = `
    <main class="reader">
      <header class="reader-header">
        <div class="doc-meta"><button class="doc-back" id="reader-back" title="返回列表">${icons.arrow}</button><button class="toc-visibility" id="toc-visibility" aria-label="${state.tocPreferences.collapsed ? '展开目录' : '收起目录'}" aria-controls="reader-toc" aria-expanded="${!state.tocPreferences.collapsed}" title="显示或收起目录">☰<span>目录</span></button><a class="reader-home" href="/" data-home-link aria-label="长文伴读，返回首页"><span class="brand-mark" aria-hidden="true"></span></a><span class="doc-name">${escapeHtml(task.title)}</span></div>
        <div class="view-switch" aria-label="阅读视图">
          <button data-view="compare" class="${state.view === "compare" ? "active" : ""}">对照</button><button data-view="original" class="${state.view === "original" ? "active" : ""}">原文</button><button data-view="translation" class="${state.view === "translation" ? "active" : ""}">译文</button>
        </div>
        <div class="header-actions">
          <button class="button" id="view-focus" aria-pressed="${state.focusMode}">${state.focusMode ? "退出聚焦" : "聚焦重点"}</button>
          <button class="button primary" id="generate-summary" ${processing || failed ? "disabled" : ""}>${isGeneratingSummary(task) ? "查看生成进度" : task.summary ? "查看摘要" : "生成摘要"}</button>
        </div>
      </header>
      <div class="reader-body ${state.tocPreferences.collapsed ? 'toc-collapsed' : ''}" style="--toc-width:${state.tocPreferences.width}px">
        <aside class="toc" id="reader-toc" ${state.tocPreferences.collapsed ? 'hidden' : ''}>
          <div class="toc-head"><span>目录</span><button id="toc-close" aria-label="收起目录" title="收起目录">‹</button></div>
          <nav class="toc-items">${tocItems.length ? tocMarkup(tocItems) : `<div class="task-progress" style="padding:10px">未识别到目录</div>`}</nav>
          ${digestNotice(task)}
          <div class="toc-footer"><div class="footer-count"><strong id="footer-position">${readerProgressLabel(task, 0)}</strong><span id="footer-percent">0%</span></div><div class="footer-track"><span id="footer-progress" style="width:0%"></span></div><div class="reading-save-status" id="reading-save-status" role="status">${state.readingStatus.get(task.id) || "阅读进度自动保存"}</div></div>
        </aside>
        <div class="toc-divider" id="toc-divider" role="separator" tabindex="0" aria-label="调整目录宽度，双击恢复默认" aria-controls="reader-toc" aria-orientation="vertical" aria-valuemin="180" aria-valuemax="420" aria-valuenow="${state.tocPreferences.width}"></div>
        ${pdfMode ? pdfReaderMarkup(task, viewClass, failed) : `<section class="reading-area ${viewClass}" id="reading-area">
          <div class="reading-scroll" id="reading-scroll">
            <div class="column-head"><div class="original-head">原文</div><div class="translation-head">${task.paragraphs.some((p) => p.language === "en") ? "中文翻译" : "阅读文本"}</div></div>
            ${failed ? `<div class="failure-banner"><div><strong>AI 处理没有完成</strong><span>${escapeHtml(task.error || "请稍后重试")}</span></div><button class="button" id="retry-task">${task.documentAnalyzed ? "继续翻译" : "继续处理"}</button></div>` : ""}
            <div class="paragraphs">${task.paragraphs.map((p) => `<article id="${p.id}" class="paragraph-row ${p.headingLevel ? `heading-row level-${p.headingLevel}` : ""}" data-paragraph-id="${p.id}">${paragraphCell(p, "original")}${paragraphCell(p, "translation")}</article>`).join("")}</div>
          </div>
          <div class="pane-divider" id="pane-divider" role="separator" tabindex="0" aria-label="调整原文和译文宽度，双击恢复等宽" aria-orientation="vertical" aria-valuemin="25" aria-valuemax="75" aria-valuenow="50"></div>
          <div class="scroll-progress"><div class="scroll-thumb" id="scroll-thumb"></div></div>
        </section>`}
      </div>
      <nav class="focus-navigation" id="focus-navigation" aria-label="重点导航" ${state.focusMode ? "" : "hidden"}><span id="focus-count"></span><button class="button" id="focus-previous" aria-label="上一条高亮">↑ 上一条</button><button class="button" id="focus-next" aria-label="下一条高亮">↓ 下一条</button></nav>
      ${state.selection ? renderSelectionMenu() : ""}
      ${state.explanation ? renderExplainCard() : ""}
    </main>`;
  bindReaderEvents();
  document.querySelector('#refine-highlights')?.addEventListener('click',refineHighlights);
  if (pdfMode) requestAnimationFrame(() => renderPdfDocument(task));
  else requestAnimationFrame(() => {
    if (state.route !== "reader" || state.taskId !== task.id) return;
    restoreTextPosition();
    if (state.pendingFocus) document.getElementById(state.pendingFocus)?.scrollIntoView({ block: "center" });
    state.pendingFocus = null;
    state.textReady = true;
    updateScrollProgress();
    updateLinkedHighlights();
  });
}

function renderSelectionMenu() {
  const s = state.selection;
  const exact = findExactHighlight(s);
  return `<div class="selection-menu" id="selection-menu" style="left:${s.menuX}px;top:${s.menuY}px"><button data-selection-action="explain">解释</button><button data-selection-action="toggle">${exact ? "取消高亮" : "高亮"}</button></div>`;
}

function renderExplainCard() {
  const info = state.explanation;
  return `<aside class="explain-card" id="explain-card" style="left:${info.x}px;top:${info.y}px">
    <div class="explain-head"><span>文中含义</span><button class="close-x" id="close-explain">${icons.close}</button></div>
    <div class="explain-body"><div class="explain-quote">${escapeHtml(info.selection.text)}</div><div id="explain-answer">${info.loading ? "正在结合上下文解释…" : escapeHtml(info.answer)}</div></div>
    <form class="follow-row" id="follow-form"><input class="follow-input" placeholder="继续追问…" ${info.loading ? "disabled" : ""}/><button class="follow-send" ${info.loading ? "disabled" : ""}>发送</button></form>
  </aside>`;
}

function bindReaderEvents() {
  bindTocControls({ body: document.querySelector('.reader-body'), sidebar: document.querySelector('#reader-toc'),
    toggle: document.querySelector('#toc-visibility'), close: document.querySelector('#toc-close'), divider: document.querySelector('#toc-divider'),
    preferences: state.tocPreferences, storage: localStorage,
    onBeforeChange: preserveReaderPosition,
    onCommit: () => { if (state.task.sourceType === 'pdf' && state.task.sourceAvailable) renderPdfDocument(state.task); else { state.textReady = true; updateLinkedHighlights(); } },
  });
  document.querySelector("#reader-back").onclick = () => go("home");
  document.querySelectorAll("[data-view]").forEach((button) => button.onclick = () => { state.view = button.dataset.view; renderReader(); });
  document.querySelector("#view-focus").onclick = () => {
    state.focusMode = !state.focusMode; dismissSelection(); updateFocusReading();
  };
  document.querySelector("#focus-previous").onclick = () => navigateHighlight(-1);
  document.querySelector("#focus-next").onclick = () => navigateHighlight(1);
  document.querySelector("#generate-summary").onclick = () => {
    if (state.task.summary || isGeneratingSummary(state.task)) go("summary", state.task.id);
    else showSummaryOptions();
  };
  const area=document.querySelector('#reading-area'), divider=document.querySelector('#pane-divider');
  if(divider) bindPaneDivider({area,divider,ratio:state.paneRatio,
    onChange:ratio=>{state.paneRatio=ratio;},
    onCommit:()=>{if(state.task.sourceType === "pdf" && state.task.sourceAvailable){preservePdfPosition();renderPdfDocument(state.task);}else updateLinkedHighlights();},
  });
  document.querySelector("#retry-task")?.addEventListener("click", retryTask);
  document.querySelectorAll("[data-jump]").forEach((button) => button.onclick = () => {
    dismissSelection();
    if(state.pdfDocument && !state.pdfScrollSync && button.dataset.page) {state.pendingPageNumber=Number(button.dataset.page);return;}
    if (state.pdfScrollSync && button.dataset.page) {
      state.pdfScrollSync.jump(Number(button.dataset.page));
      return;
    }
    const pdfShell = button.dataset.page ? document.querySelector(`.pdf-page-shell[data-page-number="${button.dataset.page}"]`) : null;
    if (pdfShell) pdfShell.scrollIntoView({ block: "start" });
    document.querySelector(`#${CSS.escape(button.dataset.jump)}`)?.scrollIntoView({ block: "start" });
  });
  document.querySelectorAll("[data-toc-toggle]").forEach((button) => button.onclick = () => {
    const id = button.dataset.tocToggle;
    if (state.collapsedToc.has(id)) state.collapsedToc.delete(id); else state.collapsedToc.add(id);
    renderReader();
  });

  const scroll = document.querySelector("#reading-scroll");
  if (scroll) {
    scroll.addEventListener("scroll", updateScrollProgress, { passive: true });
    setupScrollThumb();
    scroll.addEventListener("mouseup", handleTextSelection);
    scroll.addEventListener("click", handleReaderClick);
    scroll.addEventListener("pointerdown", handleRangeDrag);
  } else {
    bindPdfReaderEvents();
  }

  document.querySelectorAll("[data-selection-action]").forEach((button) => button.onclick = (event) => {
    event.stopPropagation();
    if (button.dataset.selectionAction === "explain") startExplanation(state.selection);
    else toggleSelectionHighlight();
  });
  document.querySelector("#close-explain")?.addEventListener("click", () => { state.explanation = null; renderReader(); });
  document.querySelector("#follow-form")?.addEventListener("submit", followUpExplanation);
}

function bindPdfReaderEvents() {
  const pdfScroll = document.querySelector("#pdf-scroll");
  const translationScroll = document.querySelector("#pdf-translation-scroll");
  pdfScroll?.addEventListener("mouseup", handlePdfTextSelection);
  pdfScroll?.addEventListener("click", handlePdfOverlayClick);
  pdfScroll?.addEventListener("pointerdown", handlePdfOverlayPointerDown);
  pdfScroll?.addEventListener("pointerdown", handlePdfSelectionDrag);
  pdfScroll?.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key) || !event.target.matches(".pdf-highlight-group")) return;
    event.preventDefault();
    event.target.querySelector(".pdf-highlight-overlay")?.click();
  });
  translationScroll?.addEventListener("mouseup", handleTextSelection);
  translationScroll?.addEventListener("click", handleReaderClick);
  translationScroll?.addEventListener("pointerdown", handleRangeDrag);
  document.querySelectorAll('[data-reading-zoom]').forEach(button => button.addEventListener('click', () => changePdfZoom(Number(button.dataset.readingZoom) * .12)));
  setupPdfScrollThumb();
}

async function handlePdfOverlayClick(event) {
  const mark = event.target.closest(".pdf-highlight-overlay");
  if (!mark) return;
  event.preventDefault();
  event.stopPropagation();
  const paragraph = state.task.paragraphs.find((item) => item.id === mark.dataset.paragraphId);
  if (!paragraph) return;
  const start = Number(mark.dataset.start);
  const end = Number(mark.dataset.end);
  const ranges = paragraph.highlights.original || [];
  const highlight = highlightGroups(paragraph.original, ranges).find((item) => item.id === mark.dataset.highlightId);
  if (!highlight) return;
  window.getSelection()?.removeAllRanges();
  const group = mark.closest(".pdf-highlight-group");
  const rects = [...group.querySelectorAll(".pdf-highlight-overlay")].map((node) => node.getBoundingClientRect());
  const sourceRect = { top: Math.min(...rects.map((r) => r.top)), height: Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top)) };
  if (paragraph.figureId) await ensureFigure(document.querySelector(`[data-figure-id="${CSS.escape(paragraph.figureId)}"]`));
  const targets = translationTargets({ paragraphId: paragraph.id, start, end });
  const rectsTranslated = [...targets.ranges.map(r => r.getBoundingClientRect()), ...targets.labels.map(l => l.getBoundingClientRect())];
  const translationRect = rectsTranslated.length ? { top: Math.min(...rectsTranslated.map(r => r.top)), height: Math.max(...rectsTranslated.map(r => r.bottom)) - Math.min(...rectsTranslated.map(r => r.top)) } : null;
  state.pdfScrollSync?.focus(paragraph.pageNumber, sourceRect, translationRect, targets.pageNumber || paragraph.pageNumber);
  const rect = group.querySelector(".pdf-highlight-overlay").getBoundingClientRect();
  state.selection = {
    paragraphId: paragraph.id,
    side: "original",
    start,
    end,
    highlightIds: highlight.ids,
    text: paragraph.original.slice(start, end),
    menuX: Math.max(8, Math.min(innerWidth - 150, rect.left)),
    menuY: Math.max(68, Math.min(innerHeight - 48, rect.top - 47)),
  };
  state.explanation = null;
  renderFloatingOnly();
}

function handlePdfOverlayPointerDown(event) {
  const handle = event.target.closest(".pdf-range-handle");
  const mark = handle?.closest(".pdf-highlight-overlay");
  if (!handle || !mark) {
    if (event.target.closest(".pdf-highlight-overlay")) event.preventDefault();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const paragraph = state.task.paragraphs.find((item) => item.id === mark.dataset.paragraphId);
  const shell = mark.closest(".pdf-page-shell");
  const textLayer = shell?.querySelector(".pdf-text-layer");
  const range = paragraph && highlightGroups(paragraph.original, paragraph.highlights.original).find((item) => item.id === mark.dataset.highlightId);
  if (!paragraph || !shell || !textLayer || !range) return;
  state.selection = null;
  state.explanation = null;
  renderFloatingOnly();
  let start = range.start;
  let end = range.end;
  const move = (moveEvent) => {
    const offset = pdfOffsetFromPoint(paragraph, textLayer, moveEvent.clientX, moveEvent.clientY);
    if (offset == null) return;
    if (handle.dataset.boundary === "start") start = Math.max(0, Math.min(offset, end - 1));
    else end = Math.min(paragraph.original.length, Math.max(offset, start + 1));
    state.highlightPreview = { paragraphId: paragraph.id, ...range, start, end };
    addPdfHighlightOverlays(shell, textLayer, paragraph.pageNumber, state.highlightPreview);
    updateLinkedHighlights();
  };
  const up = async () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    const next = [...paragraph.highlights.original.filter((item) => !range.ids.includes(item.id)), { id: range.id, start, end, kind: "user" }];
    await saveHighlights(paragraph, "original", next);
    state.highlightPreview = null;
    refreshHighlightDisplay([paragraph.id]);
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up, { once: true });
}

function changePdfZoom(delta) {
  state.pdfScale = Math.max(0.7, Math.min(1.8, state.pdfScale + delta));
  renderPdfDocument(state.task);
}

function preservePdfPosition() {
  if (state.pdfScrollSync) {
    state.pdfPosition = { taskId: state.pdfPosition?.taskId, ...state.pdfScrollSync.getPosition() };
    saveReadingState();
    state.pdfScrollSync.destroy();
    state.pdfScrollSync = null;
  }
  state.pdfObserver?.disconnect();
  state.pdfObserver = null;
  state.figureObserver?.disconnect();
  state.figureObserver = null;
  state.translationResizeObserver?.disconnect();
  state.translationResizeObserver = null;
  CSS.highlights?.delete("linked-translation");
  CSS.highlights?.delete("saved-translation");
  state.pdfRenderToken += 1;
}

function preserveReaderPosition() {
  if (state.textReady) updateScrollProgress();
  state.textReady = false;
  preservePdfPosition();
}

function saveReadingState() {
  const position = state.pdfPosition;
  if (!position?.taskId || state.task?.id !== position.taskId) return;
  readingStore.record(state.task, { kind: "pdf", position, view: state.view, scale: state.pdfScale, pageWidth: state.pdfPageWidth });
}

function restoreReadingState(task) {
  const saved = readingStore.hydrate(task);
  state.readingTaskId = task.id;
  state.pdfPosition = saved?.kind === "pdf" ? { ...saved.position, taskId: task.id } : null;
  state.textPosition = saved?.kind === "text" ? saved.position : null;
  state.currentParagraph = saved?.position.paragraphId || null;
  state.view = saved?.view || "compare";
  state.pdfScale = saved?.scale || 1;
  state.pdfPageWidth = saved?.pageWidth || null;
}

function textReadingLine(scroll) {
  return (scroll.querySelector(".column-head")?.getBoundingClientRect().height || 0) + 12;
}

function restoreTextPosition() {
  const scroll = document.querySelector("#reading-scroll"), position = state.textPosition;
  if (!scroll || !position) return;
  const row = document.getElementById(position.paragraphId);
  if (!row) return;
  const rect = row.getBoundingClientRect();
  const top = position.edge === "start" ? 0 : position.edge === "end" ? scroll.scrollHeight
    : rect.top - scroll.getBoundingClientRect().top + scroll.scrollTop + position.fraction * rect.height - textReadingLine(scroll);
  scroll.scrollTo({ top, behavior: "instant" });
}

function dismissSelection() {
  clearPdfSelectionPreview();
  if (!state.selection) return;
  state.selection = null;
  window.getSelection()?.removeAllRanges();
  document.querySelector("#selection-menu")?.remove();
  updateLinkedHighlights();
}

function clearPdfSelectionPreview() {
  document.querySelectorAll(".pdf-selection-preview").forEach(node => node.remove());
}

function handlePdfSelectionDrag(event) {
  if (event.button !== 0 || event.target.closest(".pdf-highlight-group")) return;
  const shell = event.target.closest(".pdf-page-shell");
  const textLayer = shell?.querySelector(".pdf-text-layer");
  if (!textLayer) return;
  const paragraphs = state.task.paragraphs.filter(p => p.pageNumber === Number(shell.dataset.pageNumber));
  const first = pdfSelectionPoint(paragraphs, textLayer, event.clientX, event.clientY);
  if (!first) return;
  let moved = false;
  let matches = [];
  let menuRect;
  const listeners = new AbortController();
  const move = (pointer) => {
    if (!shell.isConnected) return listeners.abort();
    if (!moved && Math.hypot(pointer.clientX - event.clientX, pointer.clientY - event.clientY) < 3) return;
    moved = true;
    shell.classList.add("pdf-drag-selecting");
    const last = pdfSelectionPoint(paragraphs, textLayer, pointer.clientX, pointer.clientY);
    window.getSelection()?.removeAllRanges();
    if (!last) { matches = []; clearPdfSelectionPreview(); return; }
    matches = pdfSelectionBetween(paragraphs, first, last);
    clearPdfSelectionPreview();
    const origin = shell.getBoundingClientRect();
    const rects = [];
    for (const selected of matches) {
      const paragraph = paragraphs.find(p => p.id === selected.paragraphId);
      for (const segment of paragraph.sourceSegments || []) {
        rects.push(...segmentDomRange(textLayer, segment, selected.start, selected.end)?.getClientRects() || []);
      }
    }
    for (const rect of mergeHighlightRects(rects)) {
      const preview = document.createElement("span");
      preview.className = "pdf-selection-preview";
      Object.assign(preview.style, { left: `${rect.left - origin.left}px`, top: `${rect.top - origin.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      shell.append(preview);
    }
    menuRect = rects[0];
  };
  document.addEventListener("pointermove", move, { signal: listeners.signal });
  document.addEventListener("pointercancel", () => { listeners.abort(); shell.classList.remove("pdf-drag-selecting"); clearPdfSelectionPreview(); }, { once: true, signal: listeners.signal });
  document.addEventListener("pointerup", (pointer) => {
    listeners.abort();
    if (!moved) return;
    move(pointer);
    shell.classList.remove("pdf-drag-selecting");
    window.getSelection()?.removeAllRanges();
    if (document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest(".pdf-page-shell") !== shell) {
      clearPdfSelectionPreview();
      return toast("请在同一页中划取文字");
    }
    if (!matches.length || !menuRect || !shell.isConnected) return clearPdfSelectionPreview();
    state.selection = {
      ...matches[0], ranges: matches, text: matches.map(item => item.text).join("\n"), pdfPointerSelection: true,
      menuX: Math.max(8, Math.min(innerWidth - 150, menuRect.left)),
      menuY: Math.max(68, Math.min(innerHeight - 48, menuRect.top - 47)),
    };
    state.explanation = null;
    renderFloatingOnly();
  }, { once: true, signal: listeners.signal });
}

async function loadPdfJs() {
  const pdfjs = await import("/vendor/pdfjs/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/build/pdf.worker.mjs";
  return pdfjs;
}

async function renderPdfDocument(task) {
  if (state.route !== "reader" || state.taskId !== task.id) return;
  const container = document.querySelector("#pdf-pages");
  const scroll = document.querySelector("#pdf-scroll");
  if (!container || !scroll) return;
  preservePdfPosition();
  const position = state.pdfPosition?.taskId === task.id ? state.pdfPosition : null;
  const token = ++state.pdfRenderToken;
  container.innerHTML = `<div class="pdf-loading">正在打开原 PDF…</div>`;
  try {
    state.pdfDocument?.destroy?.();
    const pdfjs = await loadPdfJs();
    const loadingTask = pdfjs.getDocument({ url: `/api/tasks/${task.id}/source`, httpHeaders:workspaceHeaders() });
    const pdf = await loadingTask.promise;
    if (token !== state.pdfRenderToken) return pdf.destroy();
    state.pdfDocument = pdf;
    state.pdfJs = pdfjs;
    const availableWidth = scroll.clientWidth || document.querySelector("#pdf-translation-scroll").clientWidth;
    const pageWidth = Math.max(320, availableWidth - 42) * state.pdfScale;
    state.pdfPageWidth = pageWidth;
    state.figureRects = new Map(); state.figureRegions = new Map();
    const pageHeights = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const viewport = page.getViewport({ scale: 1 });
      const figures = (task.figures || []).filter(f => f.pageNumber === index + 1);
      if (figures.length) {
        const graphics = pageGraphicBounds(await page.getOperatorList(), viewport, pdfjs.OPS);
        figures.forEach(f => { state.figureRects.set(f.id, completeFigureRect(f, graphics, task.paragraphs)); state.figureRegions.set(f.id, figurePaintRegions(f, graphics, task.paragraphs)); });
      }
      return pageWidth * viewport.height / viewport.width;
    }));
    if (token !== state.pdfRenderToken || !container.isConnected) return;
    state.pdfPageHeights = pageHeights;
    container.innerHTML = pageHeights.map((height, index) => `<div class="pdf-page-shell" data-page-number="${index + 1}" style="width:${pageWidth}px;height:${height}px"><span class="pdf-page-number">${index + 1}</span></div>`).join("");
    document.querySelectorAll(".pdf-translation-page").forEach((page) => {
      page.style.minHeight = `${pageHeights[Number(page.dataset.pageNumber) - 1] + 22}px`;
      page.style.setProperty("--source-page-width", `${pageWidth}px`);
    });
    for (const figure of task.figures || []) {
      const crop = state.figureRects.get(figure.id) || figure.rect;
      const element = document.querySelector(`[data-figure-id="${CSS.escape(figure.id)}"]`);
      if (element) {
        element.style.aspectRatio = String(crop.width * pageWidth / (crop.height * pageHeights[figure.pageNumber - 1]));
        element.style.setProperty("--source-figure-width", `${crop.width * pageWidth}px`);
        element.dataset.sourceWidth=String(crop.width * pageWidth);
      }
    }
    for (const element of document.querySelectorAll('.pdf-translation-paragraph')) {
      const text = element.querySelector('.paragraph-text');
      const paragraph = [...task.paragraphs, ...state.pullQuotes].find(p => p.id === text.dataset.paragraphId);
      const fragment = state.translationFragments.get(paragraph.id)?.find(f => f.start === Number(text.dataset.textStart));
      const height = pageHeights[Number(element.closest('.pdf-translation-page').dataset.pageNumber) - 1];
      const fontSize = sourceFontSize(fragment || paragraph, height);
      if (!fontSize) continue;
      text.style.fontSize = `${fontSize}px`;
      const heading = element.querySelector(".translation-section-title");
      const first = paragraph.sourceSegments.find((s) => s.text?.trim() && s.rect?.height);
      if (heading && first) heading.style.fontSize = `${first.rect.height * height}px`;
    }
    document.querySelectorAll(".translation-inserted-title[data-source-title]").forEach((heading) => {
      const pageNumber = Number(heading.closest(".pdf-translation-page").dataset.pageNumber);
      const source = task.paragraphs.find((p) => p.pageNumber === pageNumber && tocKey(p.original) === tocKey(heading.dataset.sourceTitle));
      const fontSize = source && sourceFontSize(source, pageHeights[pageNumber - 1]);
      if (fontSize) heading.style.fontSize = `${fontSize}px`;
    });
    layoutTranslatedPages();
    let previousTranslationWidth = document.querySelector("#pdf-translation-scroll").clientWidth;
    state.translationResizeObserver = new ResizeObserver(entries => {
      const width = entries[0].target.clientWidth;
      if (!width || Math.abs(width - previousTranslationWidth) < 1) return;
      previousTranslationWidth = width;
      layoutTranslatedPages();
      state.pdfScrollSync?.restore();
    });
    state.translationResizeObserver.observe(document.querySelector("#pdf-translation-scroll"));
    document.querySelectorAll('[data-reading-zoom-value]').forEach(label => { label.textContent = `同步 · ${Math.round(state.pdfScale * 100)}%`; });
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) renderPdfPage(pdfjs, pdf, entry.target, token);
      }
    }, { root: scroll, rootMargin: "800px 0px" });
    state.figureObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        if (entry.target.dataset.mathId) ensureMath(entry.target);
        else ensureFigure(entry.target);
      }
    }, { root: document.querySelector("#pdf-translation-scroll"), rootMargin: "800px 0px" });
    document.querySelectorAll(".translated-figure, .pdf-math").forEach(element => state.figureObserver.observe(element));
    state.pdfObserver = observer;
    document.querySelectorAll(".pdf-page-shell").forEach((shell) => observer.observe(shell));
    state.pdfPosition = { taskId: task.id, ...(position || { pageNumber: 1, fraction: 0, edge: "start" }) };
    state.pdfScrollSync = createPdfScrollSync({
      original: scroll,
      translation: document.querySelector("#pdf-translation-scroll"),
      view: state.view,
      position,
      onUserScroll: dismissSelection,
      onChange: (anchor, activeScroll) => {
        state.pdfPosition = { taskId: task.id, ...anchor };
        saveReadingState();
        updatePdfScrollProgress(anchor, activeScroll);
      },
    });
    updateLinkedHighlights();
    const focus = task.paragraphs.find((p) => p.id === state.pendingFocus);
    if (state.pendingPageNumber) {state.pdfScrollSync.jump(state.pendingPageNumber);state.pendingPageNumber=null;}
    else if (focus) state.pdfScrollSync.jump(focus.pageNumber);
  } catch (error) {
    if (token === state.pdfRenderToken) container.innerHTML = `<div class="pdf-load-error"><strong>原 PDF 打开失败</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

async function renderPdfPage(pdfjs, pdf, shell, token) {
  if (shell.dataset.rendered === "true" || shell.dataset.rendering === "true") return;
  shell.dataset.rendering = "true";
  try {
    const pageNumber = Number(shell.dataset.pageNumber);
    const page = await pdf.getPage(pageNumber);
    if (token !== state.pdfRenderToken || !shell.isConnected) return;
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = shell.clientWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });
    shell.style.height = `${viewport.height}px`;
    const canvas = document.createElement("canvas");
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const context = canvas.getContext("2d", { alpha: false });
    await page.render({
      canvasContext: context,
      viewport,
      transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
    }).promise;
    const textLayer = document.createElement("div");
    textLayer.className = "textLayer pdf-text-layer";
    // The standalone TextLayer does not inherit the viewer's page scale.
    // Without it the selectable text silently uses the UI font size.
    textLayer.style.setProperty("--total-scale-factor", String(viewport.scale * (viewport.userUnit || 1)));
    const pageParagraphs = state.task.paragraphs.filter((paragraph) => paragraph.pageNumber === pageNumber);
    const hasOcrText = pageParagraphs.some((paragraph) => paragraph.sourceSegments?.some((segment) => segment.ocr));
    if (hasOcrText) {
      renderOcrTextLayer(textLayer, pageParagraphs, viewport.width, viewport.height);
    } else {
      const textContent = await page.getTextContent();
      const layer = new pdfjs.TextLayer({ textContentSource: textContent, container: textLayer, viewport });
      await layer.render();
      indexPdfTextSpans(layer);
    }
    if (token !== state.pdfRenderToken || !shell.isConnected) return;
    shell.replaceChildren(canvas, textLayer);
    addPdfHighlightOverlays(shell, textLayer, pageNumber);
    shell.dataset.rendered = "true";
    updateLinkedHighlights();
    const focus = pageParagraphs.find((p) => p.id === state.pendingFocus);
    if (focus) {
      state.pendingFocus = null;
      shell.querySelector(`.pdf-highlight-group[data-paragraph-id="${CSS.escape(focus.id)}"] .pdf-highlight-overlay`)?.click();
    }
  } catch (error) {
    shell.innerHTML = `<span class="pdf-page-error">第 ${shell.dataset.pageNumber} 页加载失败</span>`;
  } finally {
    delete shell.dataset.rendering;
  }
}

function sourceRangeRect(shell, textLayer, segment, highlight) {
  const range = segmentDomRange(textLayer, segment, highlight.start, highlight.end);
  if (!range) return [];
  const shellRect = shell.getBoundingClientRect();
  const rects = [...range.getClientRects()].filter((rect) => rect.width >= 0.5 && rect.height >= 1).map((rect) => ({
    left: rect.left - shellRect.left,
    top: rect.top - shellRect.top,
    width: rect.width,
    height: rect.height,
  }));
  const merged = [];
  for (const rect of rects.sort((a, b) => a.top - b.top || a.left - b.left)) {
    const previous = merged.at(-1);
    if (previous && Math.abs(previous.top - rect.top) < 2 && Math.abs(previous.height - rect.height) < 2 && rect.left <= previous.left + previous.width + rect.height * 0.7) {
      previous.width = Math.max(previous.left + previous.width, rect.left + rect.width) - previous.left;
    } else merged.push(rect);
  }
  return merged;
}

function addPdfHighlightOverlays(shell, textLayer, pageNumber, preview = null) {
  shell.querySelector(".pdf-highlight-layer")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "pdf-highlight-layer";
  const pageParagraphs = state.task.paragraphs.filter((paragraph) => paragraph.pageNumber === pageNumber);
  for (const paragraph of pageParagraphs) {
    for (let highlight of highlightGroups(paragraph.original, paragraph.highlights.original)) {
      if (preview?.paragraphId === paragraph.id && preview.id === highlight.id) highlight = preview;
      const quote = paragraph.original.slice(highlight.start, highlight.end);
      if (!quote.trim()) continue;
      const rects = mergeHighlightRects((paragraph.sourceSegments || []).flatMap((segment) => sourceRangeRect(shell, textLayer, segment, highlight) || []));
      if (!rects.length) continue;
      const left = Math.min(...rects.map((r) => r.left));
      const top = Math.min(...rects.map((r) => r.top));
      const group = document.createElement("div");
      group.className = "pdf-highlight-group";
      group.style.left = `${left}px`;
      group.style.top = `${top}px`;
      group.style.width = `${Math.max(...rects.map((r) => r.left + r.width)) - left}px`;
      group.style.height = `${Math.max(...rects.map((r) => r.top + r.height)) - top}px`;
      group.dataset.highlightId = highlight.id;
      group.dataset.paragraphId = paragraph.id;
      group.dataset.start = String(highlight.start);
      group.dataset.end = String(highlight.end);
      group.tabIndex = 0;
      group.setAttribute("role", "button");
      group.setAttribute("aria-label", `高亮：${quote}`);
      overlay.append(group);
      const marks = rects.map((rect) => {
        const mark = document.createElement("span");
        mark.className = "pdf-highlight-overlay";
        mark.dataset.highlightId = highlight.id;
        mark.dataset.paragraphId = paragraph.id;
        mark.dataset.start = String(highlight.start);
        mark.dataset.end = String(highlight.end);
        mark.style.left = `${rect.left - left}px`;
        mark.style.top = `${rect.top - top}px`;
        mark.style.width = `${rect.width}px`;
        mark.style.height = `${rect.height}px`;
        group.append(mark);
        return mark;
      });
      const startHandle = document.createElement("button");
      startHandle.className = "pdf-range-handle start";
      startHandle.dataset.boundary = "start";
      startHandle.setAttribute("aria-label", "拖动高亮起点");
      marks[0].append(startHandle);
      const endHandle = document.createElement("button");
      endHandle.className = "pdf-range-handle end";
      endHandle.dataset.boundary = "end";
      endHandle.setAttribute("aria-label", "拖动高亮终点");
      marks.at(-1).append(endHandle);
    }
  }
  shell.append(overlay);
}

const figureRenders = new WeakMap();
async function ensureFigure(element) {
  if (!element || !state.pdfDocument) return;
  const figure = state.task.figures?.find(f => f.id === element.dataset.figureId);
  if (!figure) return;
  if (figureRenders.has(element)) return figureRenders.get(element);
  const promise = (async () => {
    const page = await state.pdfDocument.getPage(figure.pageNumber);
    await renderTranslatedFigure({ page, pdfjs: state.pdfJs, figure, element, paragraphs: state.task.paragraphs, sourcePageWidth: state.pdfPageWidth, onReady: () => { layoutTranslatedPages(); updateLinkedHighlights(); } });
  })();
  figureRenders.set(element, promise);
  return promise;
}

async function ensureMath(element) {
  if (!element || !state.pdfDocument) return;
  const block = state.mathBlocks.find(b => b.id === element.dataset.mathId);
  if (!block) return;
  const page = await state.pdfDocument.getPage(block.pageNumber);
  return renderPdfMath({ page, block, element });
}

function layoutTranslatedPages() {
  if (!state.pdfPageHeights) return;
  const figures = (state.task.figures || []).map(f => ({...f, rect: state.figureRects?.get(f.id) || f.rect, paintRegions: state.figureRegions?.get(f.id)}));
  document.querySelectorAll(".pdf-translation-page").forEach(page => layoutTranslationPage(page, state.task, {
    sourceWidth: state.pdfPageWidth, sourceHeight: state.pdfPageHeights[Number(page.dataset.pageNumber)-1], figures, quotes:state.pullQuotes || [], formulas:state.mathBlocks || [],
  }));
}

function translationTargets(selection) {
  const mapped = linkedTranslationRanges(state.task, selection.paragraphId, selection.start, selection.end);
  const paragraphs = document.querySelectorAll(`.paragraph-text[data-paragraph-id="${CSS.escape(mapped.paragraphId)}"][data-side="translation"]`);
  const ranges = [...paragraphs].flatMap(p => mapped.ranges.map(r => domTextRange(p, Math.max(r.start, Number(p.dataset.textStart || 0)), Math.min(r.end, Number(p.dataset.textEnd || p.textContent.length))))).filter(Boolean);
  const chartLabels = (state.task.figures || []).flatMap(f => f.labels).filter(label =>
    (label.sources || [{ paragraphId: label.paragraphId, start: label.sourceStart, end: label.sourceEnd }]).some(source => source.paragraphId === selection.paragraphId && source.start < selection.end && source.end > selection.start))
    ;
  const labels = [];
  for (const block of state.mathBlocks || []) {
    if (!block.paragraphIds.includes(selection.paragraphId)) continue;
    const element = document.querySelector(`[data-math-id="${CSS.escape(block.id)}"]`);
    if (element) labels.push(element);
  }
  for(const label of chartLabels) {
    const element = document.getElementById(`translated-${label.id}`);
    if(!element)continue;
    const ink=element.querySelector('.figure-label-ink');
    if(!ink) {labels.push(element);continue;}
    const sources=label.sources || [{paragraphId:label.paragraphId,start:label.sourceStart,end:label.sourceEnd}];
    let offset=0;
    const total=sources.reduce((n,s)=>n+s.end-s.start,0);
    for(const source of sources) {
      const length=source.end-source.start;
      if(source.paragraphId===selection.paragraphId && source.start<selection.end && source.end>selection.start) {
        const part=projectAlignedRange({sourceStart:source.start,sourceEnd:source.end,start:Math.floor(offset/total*(label.translation || label.original).length),end:Math.ceil((offset+length)/total*(label.translation || label.original).length)},selection.start,selection.end);
        const range=domTextRange(ink,part.start,part.end);if(range)ranges.push(range);
      }
      offset+=length;
    }
  }
  for (const part of pullQuoteRanges(state.pullQuotes || [],selection.paragraphId,selection.start,selection.end)) {
    const text=document.getElementById(part.paragraphId)?.querySelector(".paragraph-text");
    const range=text && domTextRange(text,part.start,part.end);
    if (range) ranges.push(range);
  }
  const firstParent = ranges[0]?.startContainer.parentElement;
  return { ranges, labels, pageNumber: Number(firstParent?.closest('.pdf-translation-page')?.dataset.pageNumber) || state.task.paragraphs.find(p => p.id === mapped.paragraphId)?.pageNumber };
}

function refreshHighlightDisplay(ids) {
  const changed = new Set(ids);
  for(const shell of document.querySelectorAll('.pdf-page-shell[data-rendered="true"]')) {
    if(state.task.paragraphs.some(p=>changed.has(p.id) && p.pageNumber===Number(shell.dataset.pageNumber)))
      addPdfHighlightOverlays(shell,shell.querySelector('.pdf-text-layer'),Number(shell.dataset.pageNumber));
  }
  // Only text nodes/marks in edited paragraphs change. PDF canvases and scroll
  // containers retain their identity, rendered state and position.
  for(const node of document.querySelectorAll('.paragraph-text')) {
    if(!changed.has(node.dataset.paragraphId))continue;
    const paragraph=state.task.paragraphs.find(p=>p.id===node.dataset.paragraphId);
    if(!paragraph)continue;
    if(node.closest('.pdf-translation-paragraph')) {
      const wrapper=node.closest('.pdf-translation-paragraph');
      const template=document.createElement('template');
      const fragment = state.translationFragments.get(paragraph.id)?.find(f => f.start === Number(node.dataset.textStart || 0));
      template.innerHTML=translationParagraphMarkup(paragraph,readerTocItems(state.task).filter(p=>p.pageNumber===(fragment?.pageNumber || paragraph.pageNumber)),fragment);
      // Heading/body placement may be absolute; copy only the mark-bearing text.
      const fresh=template.content.querySelector('.paragraph-text');
      if(node.querySelector('.translation-section-title') && fresh.querySelector('.translation-section-title')) {
        for(const name of ['translation-section-title','translation-body-text']) {
          const old=node.querySelector(`.${name}`), next=fresh.querySelector(`.${name}`);if(old&&next)old.innerHTML=next.innerHTML;
        }
      } else if(!wrapper.classList.contains('is-pull-quote')) node.innerHTML=fresh.innerHTML;
    } else node.innerHTML=richText(paragraph[node.dataset.side],paragraph.highlights[node.dataset.side],paragraph.id,node.dataset.side);
  }
  renderFloatingOnly();
}

function focusItems() {
  return (state.task?.paragraphs || []).flatMap(paragraph=>[
    ...highlightGroups(paragraph.original,paragraph.highlights?.original || []).map(range=>({...range,paragraphId:paragraph.id,pageNumber:paragraph.pageNumber,side:'original'})),
    ...(paragraph.highlights?.translation || []).map(range=>({...range,paragraphId:paragraph.id,pageNumber:paragraph.pageNumber,side:'translation'})),
  ]);
}
function updateFocusReading(saved) {
  const reader=document.querySelector('.reader');if(!reader)return;
  reader.classList.toggle('focus-reading',state.focusMode);
  const toggle=document.querySelector('#view-focus');toggle.textContent=state.focusMode?'退出聚焦':'聚焦重点';toggle.setAttribute('aria-pressed',String(state.focusMode));
  document.querySelector('#focus-navigation').hidden=!state.focusMode;
  const items=focusItems();
  const current=items.findIndex(item=>item.paragraphId===state.selection?.paragraphId && item.start===state.selection.start && item.side===state.selection.side);
  document.querySelector('#focus-count').textContent=current<0?`${items.length} 处重点`:`${current+1} / ${items.length}`;
  document.querySelector('#focus-previous').disabled=!items.length || current===0;
  document.querySelector('#focus-next').disabled=!items.length || current===items.length-1;
  for(const shell of document.querySelectorAll('.pdf-page-shell[data-rendered="true"]')) {
    setFocusVeil(shell,[...shell.querySelectorAll('.pdf-highlight-overlay')].map(n=>n.getBoundingClientRect()),state.focusMode);
  }
  if(state.focusMode && !saved) {
    saved={ranges:[],labels:new Set()};
    for(const item of items.filter(i=>i.side==='original')) {const target=translationTargets(item);saved.ranges.push(...target.ranges);target.labels.forEach(l=>saved.labels.add(l));}
  }
  const pageRects=new Map();
  if(state.focusMode) {
    const collect=(node,rects)=>{const page=node?.closest('.pdf-translation-page');if(page)pageRects.set(page,[...(pageRects.get(page)||[]),...rects]);};
    for(const range of saved?.ranges || [])collect(range.startContainer.parentElement,[...range.getClientRects()]);
    for(const label of saved?.labels || [])collect(label,[label.getBoundingClientRect()]);
    for(const mark of document.querySelectorAll('.pdf-translation-page .highlight'))collect(mark,[...mark.getClientRects()]);
  }
  for(const page of document.querySelectorAll('.pdf-translation-page'))setFocusVeil(page,pageRects.get(page)||[],state.focusMode);
  for(const cell of document.querySelectorAll('.paragraph-cell')) {
    const rects=[...cell.querySelectorAll('.highlight')].flatMap(mark=>[...mark.getClientRects()]);
    if(cell.classList.contains('translation-cell')) for(const range of saved?.ranges || [])if(cell.contains(range.startContainer))rects.push(...range.getClientRects());
    setFocusVeil(cell,rects,state.focusMode);
  }
}
async function navigateHighlight(direction) {
  const items=focusItems();if(!items.length)return;
  const current=items.findIndex(item=>item.paragraphId===state.selection?.paragraphId && item.start===state.selection.start && item.side===state.selection.side);
  let index;
  if(current>=0)index=Math.max(0,Math.min(items.length-1,current+direction));
  else {
    const page=state.pdfPosition?.pageNumber || 1;
    index=direction>0?items.findIndex(item=>(item.pageNumber || 1)>=page):items.findLastIndex(item=>(item.pageNumber || 1)<=page);
    if(index<0)index=direction>0?items.length-1:0;
  }
  const item=items[index];
  if(state.task.sourceType==='pdf' && state.task.sourceAvailable && item.side==='original') {
    if(state.view==='translation') {
      const paragraph=state.task.paragraphs.find(p=>p.id===item.paragraphId);
      if(paragraph.figureId)await ensureFigure(document.querySelector(`[data-figure-id="${CSS.escape(paragraph.figureId)}"]`));
      const target=translationTargets(item), rect=target.ranges[0]?.getBoundingClientRect() || target.labels[0]?.getBoundingClientRect();
      const pane=document.querySelector('#pdf-translation-scroll');
      if(rect)pane.scrollTop+=rect.top-pane.getBoundingClientRect().top-pane.clientHeight*.3;
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      state.selection={...item,highlightIds:item.ids || [item.id],text:paragraph.original.slice(item.start,item.end),menuX:0,menuY:-100};
      updateLinkedHighlights();
    } else {
      const shell=document.querySelector(`.pdf-page-shell[data-page-number="${item.pageNumber}"]`);
      if(!shell || !state.pdfDocument)return;
      if(shell.dataset.rendered!=='true')await renderPdfPage(state.pdfJs,state.pdfDocument,shell,state.pdfRenderToken);
      const mark=shell.querySelector(`.pdf-highlight-group[data-highlight-id="${CSS.escape(item.id)}"] .pdf-highlight-overlay`);
      if(!mark)return;
      const pane=document.querySelector('#pdf-scroll');
      pane.scrollTop+=mark.getBoundingClientRect().top-pane.getBoundingClientRect().top-pane.clientHeight*.3;
      // Let the scroll event dismiss the previous selection before focusing next.
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      await handlePdfOverlayClick({target:mark,preventDefault(){},stopPropagation(){}});
    }
  } else {
    const selector=`.paragraph-text[data-paragraph-id="${CSS.escape(item.paragraphId)}"][data-side="${item.side}"]`;
    const mark=[...document.querySelectorAll(selector)].map(p => p.querySelector(`[data-highlight-id="${CSS.escape(item.id)}"]`)).find(Boolean);
    mark?.scrollIntoView({block:'center',behavior:'instant'});mark?.click();
  }
}

function updateLinkedHighlights() {
  const selection = state.highlightPreview ? {...state.highlightPreview, side:"original", highlightIds:[state.highlightPreview.id]} : state.selection || state.explanation?.selection;
  const linked = selection?.side === "original" && selection.highlightIds?.length;
  const translatedActive = selection?.side === "translation" && selection.sourceRefs?.length;
  document.querySelectorAll(".pdf-highlight-group").forEach((group) => {
    const active = Boolean(linked && group.dataset.paragraphId === selection.paragraphId
      && Number(group.dataset.start) === selection.start && Number(group.dataset.end) === selection.end || translatedActive && selection.sourceRefs.some(ref => {
        if (ref.paragraphId !== group.dataset.paragraphId || ref.side !== 'original') return false;
        const range = state.task.paragraphs.find(p => p.id === ref.paragraphId)?.highlights.original.find(r => r.id === ref.id);
        return range && range.start < Number(group.dataset.end) && range.end > Number(group.dataset.start);
      }));
    group.classList.toggle("editing", active);
    group.setAttribute("aria-pressed", String(active));
  });
  const saved = { ranges: [], labels: new Set() };
  for (const paragraph of state.task?.paragraphs || []) {
    const sourceRanges = (paragraph.highlights?.original || []).filter(r=>!(state.highlightPreview?.paragraphId === paragraph.id && (state.highlightPreview.ids || [state.highlightPreview.id]).includes(r.id)));
    if(state.highlightPreview?.paragraphId === paragraph.id) sourceRanges.push(state.highlightPreview);
    for (const range of sourceRanges) {
      const target = translationTargets({ paragraphId: paragraph.id, ...range });
      for (const mapped of target.ranges) mapped.sourceRefs = [{ paragraphId: paragraph.id, id: range.id, side: "original" }];
      saved.ranges.push(...target.ranges);
      target.labels.forEach(label => saved.labels.add(label));
    }
  }
  for(const ink of document.querySelectorAll('.figure-label-ink')) {
    ink.dataset.savedRanges=JSON.stringify(saved.ranges.filter(range=>ink.contains(range.startContainer) && ink.contains(range.endContainer)).map(range=>({start:range.startOffset,end:range.endOffset})));
  }
  if (globalThis.Highlight && CSS.highlights) CSS.highlights.set("saved-translation", new Highlight(...saved.ranges));
  document.querySelectorAll("[data-chart-paragraph], .pdf-math").forEach(label => label.classList.toggle("saved-chart-label", saved.labels.has(label)));
  const activeContainer = translatedActive && translatedContainer(selection);
  const activeRange = activeContainer && domTextRange(activeContainer, selection.start, selection.end);
  const targets = linked ? translationTargets(selection) : { ranges: activeRange ? [activeRange] : [], labels: [] };
  if (globalThis.Highlight && CSS.highlights) CSS.highlights.set("linked-translation", new Highlight(...targets.ranges));
  document.querySelectorAll("[data-chart-paragraph], .pdf-math").forEach(label => label.classList.toggle("linked-chart-label", targets.labels.includes(label)));
  updateFocusReading(saved);
  const legacy = [...document.querySelectorAll('.highlight[data-side="translation"]')].map(mark => {
    const range = document.createRange(); range.selectNodeContents(mark);
    range.sourceRefs = [{ paragraphId: mark.dataset.paragraphId, id: mark.dataset.highlightId, side: 'translation' }]; return range;
  });
  updateTranslatedHitRanges([...saved.ranges, ...legacy]);
  renderHighlightSaveStatus();
}

// CSS Highlights keep text selectable. A compact hit map adds editing without
// wrapping/replacing every sentence or re-rendering the PDF canvases.
function updateTranslatedHitRanges(ranges) {
  const byContainer = new Map();
  for (const range of ranges) {
    const parent = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const container = parent?.closest('.paragraph-text[data-side="translation"], .figure-label-ink');
    if (!container || !container.contains(range.endContainer)) continue;
    const offsets = selectionOffsets(container, range);
    const list = byContainer.get(container) || [];
    list.push({ ...offsets, sourceRefs: range.sourceRefs || [] }); byContainer.set(container, list);
  }
  state.translatedHits = [];
  for (const [container, list] of byContainer) {
    const merged = [];
    for (const part of list.sort((a, b) => a.start - b.start)) {
      const previous = merged.at(-1);
      if (previous && previous.end >= part.start) { previous.end = Math.max(previous.end, part.end); previous.sourceRefs.push(...part.sourceRefs); }
      else merged.push({ ...part, sourceRefs: [...part.sourceRefs] });
    }
    for (const part of merged) {
      part.sourceRefs = [...new Map(part.sourceRefs.map(r => [`${r.paragraphId}:${r.side}:${r.id}`, r])).values()];
      state.translatedHits.push({ ...part, container, range: domTextRange(container, part.start, part.end) });
    }
  }
  renderTranslationHandles();
}
function translatedDescriptor(container) {
  return { paragraphId: container.dataset.paragraphId || container.closest('[data-chart-paragraph]')?.dataset.chartParagraph,
    labelId: container.closest('[data-label-id]')?.dataset.labelId, side: 'translation' };
}
function translatedContainer(selection) {
  return selection.labelId ? document.getElementById(`translated-${selection.labelId}`)?.querySelector('.figure-label-ink')
    : [...document.querySelectorAll(`.paragraph-text[data-paragraph-id="${CSS.escape(selection.paragraphId)}"][data-side="translation"]`)].find(p => selection.start >= Number(p.dataset.textStart || 0) && selection.start < Number(p.dataset.textEnd || p.textContent.length));
}
function handleTranslatedHighlightClick(event) {
  if (!window.getSelection()?.isCollapsed || state.translationDragging) return false;
  const hit = (state.translatedHits || []).find(hit => hit.container.contains(event.target) && [...hit.range.getClientRects()].some(r => event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom));
  if (!hit) return false;
  event.preventDefault(); event.stopPropagation();
  const rect = hit.range.getBoundingClientRect();
  state.selection = { ...translatedDescriptor(hit.container), start: hit.start, end: hit.end, initialStart: hit.start, initialEnd: hit.end, text: hit.range.toString(), sourceRefs: hit.sourceRefs,
    menuX: Math.max(8, Math.min(innerWidth - 150, event.clientX - 70)), menuY: Math.max(68, Math.min(innerHeight - 48, rect.top - 47)) };
  state.explanation = null;
  const source = hit.sourceRefs.find(r => r.side === 'original');
  const p = state.task.paragraphs.find(p => p.id === source?.paragraphId);
  const r = p?.highlights.original.find(r => r.id === source.id);
  const shell = p && document.querySelector(`.pdf-page-shell[data-page-number="${p.pageNumber}"]`);
  const segments = r && p.sourceSegments.filter(s => s.start < r.end && s.end > r.start);
  if (shell && segments?.length) {
    const box = shell.getBoundingClientRect();
    const sourceRect = { top: box.top + Math.min(...segments.map(s => s.rect.top)) * box.height };
    state.pdfScrollSync?.focus(p.pageNumber, sourceRect, rect, Number(hit.container.closest('.pdf-translation-page')?.dataset.pageNumber) || p.pageNumber, 'translation');
  }
  renderFloatingOnly(); return true;
}
function renderTranslationHandles() {
  document.querySelectorAll('.translation-range-handle').forEach(node => node.remove());
  const s = state.selection;
  if (s?.side !== 'translation' || !s.sourceRefs?.length || state.translationDragging) return;
  const container = translatedContainer(s), range = container && domTextRange(container, s.start, s.end);
  const rects = range && [...range.getClientRects()].filter(r => r.width && r.height);
  if (!rects?.length) return;
  for (const [boundary, rect] of [['start', rects[0]], ['end', rects.at(-1)]]) {
    const handle = document.createElement('button'); handle.className = 'translation-range-handle';
    handle.setAttribute('aria-label', boundary === 'start' ? '调整译文高亮起点' : '调整译文高亮终点');
    handle.style.left = `${(boundary === 'start' ? rect.left : rect.right) - 5}px`;
    handle.style.top = `${(boundary === 'start' ? rect.top : rect.bottom) - 5}px`;
    handle.onpointerdown = event => dragTranslationBoundary(event, boundary, s, container);
    document.querySelector('.reader')?.append(handle);
  }
}
function dragTranslationBoundary(event, boundary, selection, container) {
  event.preventDefault(); event.stopPropagation();
  const task = state.task;
  const baseline = new Map(task.paragraphs.map(p => [p.id, structuredClone(p.highlights)]));
  let start = selection.start, end = selection.end, moved = false;
  state.translationDragging = true;
  const restore = () => { for (const p of task.paragraphs) p.highlights = structuredClone(baseline.get(p.id)); };
  const move = e => {
    const offset = offsetFromPoint(container, e.clientX, e.clientY);
    if (offset === null) return;
    const base = Number(container.dataset.textStart || 0);
    if (boundary === 'start') start = Math.max(base, Math.min(offset, end - 1)); else end = Math.min(base + container.textContent.length, Math.max(offset, start + 1));
    moved = true; restore();
    const updates = translatedSelectionUpdates({ ...selection, start, end });
    for (const item of updates) task.paragraphs.find(p => p.id === item.paragraphId).highlights[item.side] = item.highlights;
    state.selection = { ...selection, start, end, text: container.textContent.slice(start - base, end - base) };
    refreshHighlightDisplay(updates.map(u => u.paragraphId));
  };
  const finish = e => {
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', finish); document.removeEventListener('pointercancel', finish);
    restore(); state.translationDragging = false;
    if (state.task !== task) return;
    if (moved && e.type !== 'pointercancel') commitHighlightUpdates(translatedSelectionUpdates({ ...selection, start, end }));
    else { state.selection = selection; refreshHighlightDisplay(task.paragraphs.map(p => p.id)); }
  };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', finish); document.addEventListener('pointercancel', finish);
}

function handlePdfTextSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return;
  const range = selection.getRangeAt(0);
  const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
  const shell = startElement?.closest(".pdf-page-shell");
  if (!shell || shell !== endElement?.closest(".pdf-page-shell")) return toast("请在同一页中划取文字");
  const paragraphs = state.task.paragraphs.filter((paragraph) => paragraph.pageNumber === Number(shell.dataset.pageNumber));
  const matches = selectionFromPdfRange(paragraphs, shell.querySelector(".pdf-text-layer"), range);
  if (!matches.length) return toast("这段文字的原文位置暂时不可用，请重新导入文件");
  const matched = { ...matches[0], ranges: matches, text: matches.map((item) => item.text).join("\n") };
  const rect = range.getBoundingClientRect();
  const menuWidth = 142;
  state.selection = {
    ...matched,
    menuX: Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.left + rect.width / 2 - menuWidth / 2)),
    menuY: Math.max(68, Math.min(window.innerHeight - 48, rect.top - 47)),
  };
  state.explanation = null;
  renderFloatingOnly();
}

function updatePdfScrollProgress(position, scroll) {
  const thumb = document.querySelector("#scroll-thumb");
  if (!scroll || !thumb || !state.task) return;
  const max = Math.max(1, scroll.scrollHeight - scroll.clientHeight);
  const percent = Math.max(0, Math.min(100, (scroll.scrollTop / max) * 100));
  const thumbHeight = Math.max(28, (scroll.clientHeight / scroll.scrollHeight) * scroll.clientHeight);
  thumb.style.height = `${thumbHeight}px`;
  thumb.style.top = `${(percent / 100) * (scroll.clientHeight - thumbHeight)}px`;
  const readingPercent = readingStore.get(state.task.id)?.percent ?? Math.round(percent);
  document.querySelector("#footer-percent").textContent = `${readingPercent}%`;
  document.querySelector("#footer-progress").style.width = `${readingPercent}%`;
  const pageNumber = position.pageNumber;
  document.querySelector("#footer-position").textContent = `${pageNumber} / ${state.task.pageCount} 页`;
  const tocButtons = [...document.querySelectorAll(".toc-item[data-page]")];
  tocButtons.forEach((button) => button.classList.remove("active"));
  const activeToc = tocButtons.filter((button) => Number(button.dataset.page) <= pageNumber).at(-1) || tocButtons[0];
  activeToc?.classList.add("active");
}

function setupPdfScrollThumb() {
  const thumb = document.querySelector("#scroll-thumb");
  const scroll = document.querySelector(state.view === "translation" ? "#pdf-translation-scroll" : "#pdf-scroll");
  if (!thumb || !scroll) return;
  thumb.onpointerdown = (event) => {
    event.preventDefault();
    thumb.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startTop = scroll.scrollTop;
    const scale = (scroll.scrollHeight - scroll.clientHeight) / Math.max(1, scroll.clientHeight - thumb.offsetHeight);
    thumb.onpointermove = (move) => { scroll.scrollTop = startTop + (move.clientY - startY) * scale; };
    thumb.onpointerup = () => { thumb.onpointermove = null; };
  };
}

async function retryTask() {
  const taskId = state.task.id;
  const button = document.querySelector("#retry-task");
  button.disabled = true;
  button.textContent = "正在重新处理…";
  try {
    const result = await api(`/api/tasks/${taskId}/retry`, { method: "POST" });
    if (state.taskId !== taskId || state.route !== "reader") return;
    state.task = result.task;
    renderReader();
  } catch (error) {
    toast(error.message);
    if (button.isConnected) { button.disabled = false; button.textContent = "继续处理"; }
  }
}

function selectionOffsets(container, range) {
  const prefix = range.cloneRange();
  prefix.selectNodeContents(container);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length + Number(container.dataset.textStart || 0);
  return { start, end: start + range.toString().length };
}

function handleTextSelection(event) {
  if (state.translationDragging) return;
  if (event.target.closest("button")) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return;
  const range = selection.getRangeAt(0);
  const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
  const container = startElement?.closest(".paragraph-text, .figure-label-ink");
  if (!container || container !== endElement?.closest(".paragraph-text, .figure-label-ink")) return toast("请在同一段中划取文字");
  const offsets = selectionOffsets(container, range);
  const rect = range.getBoundingClientRect();
  const menuWidth = 142;
  const x = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.left + rect.width / 2 - menuWidth / 2));
  const y = Math.max(68, Math.min(window.innerHeight - 48, rect.top - 47));
  state.selection = {
    paragraphId: container.dataset.paragraphId || container.closest("[data-chart-paragraph]")?.dataset.chartParagraph,
    labelId: container.closest("[data-label-id]")?.dataset.labelId,
    side: container.dataset.side || "translation",
    start: offsets.start,
    end: offsets.end,
    text: selection.toString(),
    menuX: x,
    menuY: y,
  };
  state.explanation = null;
  renderFloatingOnly();
}

function renderFloatingOnly() {
  updateLinkedHighlights();
  document.querySelector("#selection-menu")?.remove();
  document.querySelector("#explain-card")?.remove();
  const reader = document.querySelector(".reader");
  if (!reader) return;
  if (state.selection) reader.insertAdjacentHTML("beforeend", renderSelectionMenu());
  if (state.explanation) reader.insertAdjacentHTML("beforeend", renderExplainCard());
  document.querySelectorAll("[data-selection-action]").forEach((button) => button.onclick = () => button.dataset.selectionAction === "explain" ? startExplanation(state.selection) : toggleSelectionHighlight());
  document.querySelector("#close-explain")?.addEventListener("click", () => { state.explanation = null; renderFloatingOnly(); });
  document.querySelector("#follow-form")?.addEventListener("submit", followUpExplanation);
}

function currentParagraphAndRanges(selection = state.selection) {
  const paragraph = state.task.paragraphs.find((p) => p.id === selection.paragraphId);
  return { paragraph, ranges: paragraph?.highlights?.[selection.side] || [] };
}

function findExactHighlight(selection = state.selection) {
  if (selection?.sourceRefs?.length) return { ids: selection.sourceRefs.map(r => r.id) };
  if (selection?.ranges?.length > 1) return null;
  if (!selection) return null;
  const { paragraph, ranges } = currentParagraphAndRanges(selection);
  const candidates = selection.side === "original" && paragraph?.sourceSegments
    ? highlightGroups(paragraph.original, ranges) : ranges;
  return candidates.find((range) => range.start === selection.start && range.end === selection.end) || null;
}

async function toggleSelectionHighlight() {
  const selection = state.selection;
  if (!selection) return;
  if (selection.side === 'translation') {
    const updates = translatedSelectionUpdates(selection, Boolean(selection.sourceRefs?.length));
    if (!updates.length) return toast('这段译文暂时无法定位原文');
    commitHighlightUpdates(updates); return;
  }
  if (selection.ranges?.length > 1) {
    const grouped = new Map();
    for (const item of selection.ranges) {
      const paragraph = state.task.paragraphs.find(p => p.id === item.paragraphId);
      const ranges = grouped.get(paragraph.id) || [...paragraph.highlights.original];
      ranges.push({ id: crypto.randomUUID(), start: item.start, end: item.end, kind: 'user' });
      grouped.set(paragraph.id, ranges);
    }
    commitHighlightUpdates([...grouped].map(([paragraphId, highlights]) => ({ paragraphId, side: 'original', highlights })));
    return;
  }
  const { paragraph, ranges } = currentParagraphAndRanges(selection);
  const exact = findExactHighlight(selection);
  saveHighlights(paragraph, selection.side, exact
    ? ranges.filter(range => !(exact.ids || [exact.id]).includes(range.id))
    : [...ranges, { id: crypto.randomUUID(), start: selection.start, end: selection.end, kind: 'user' }]);
}

function saveHighlights(paragraph, side, ranges) {
  return commitHighlightUpdates([{ paragraphId: paragraph.id, side, highlights: ranges }]);
}

function canonicalizeLegacyHighlights(task) {
  const changed = new Map();
  const quotes = translatedPullQuotes(task);
  for (const p of task.paragraphs) {
    if (!p.highlights?.translation?.length) continue;
    const unit = translationUnit(task, { paragraphId: p.id }, quotes);
    const remaining = [];
    for (const highlight of p.highlights.translation) {
      const mapped = sourceRangesForTranslation(unit, highlight.start, highlight.end);
      if (!mapped.length) { remaining.push(highlight); continue; }
      for (const part of mapped) {
        const source = task.paragraphs.find(p => p.id === part.paragraphId);
        if (!source.highlights.original.some(r => r.start <= part.start && r.end >= part.end)) {
          source.highlights.original.push({ id: crypto.randomUUID(), start: part.start, end: part.end, kind: highlight.kind });
          changed.set(`${source.id}:original`, { paragraphId: source.id, side: 'original', highlights: source.highlights.original });
        }
      }
    }
    if (remaining.length !== p.highlights.translation.length) {
      p.highlights.translation = remaining;
      changed.set(`${p.id}:translation`, { paragraphId: p.id, side: 'translation', highlights: remaining });
    }
  }
  if (changed.size && task.summary) task.summary.stale = true;
  return [...changed.values()];
}

function translatedSelectionUpdates(selection, remove = false) {
  const refs = selection.sourceRefs || [];
  const unit = translationUnit(state.task, selection, state.pullQuotes);
  const mapped = remove ? [] : sourceRangesForTranslation(unit, selection.start, selection.end);
  // Dragging one boundary leaves the other source boundary unchanged, avoiding
  // round-trip rounding drift within a translated sentence.
  for (const [boundary, initial] of [['start', 'initialStart'], ['end', 'initialEnd']]) {
    if (selection[boundary] !== selection[initial]) continue;
    const part = boundary === 'start' ? mapped[0] : mapped.at(-1);
    if (!part) continue;
    const source = state.task.paragraphs.find(p => p.id === part.paragraphId);
    const originals = source.highlights.original.filter(r => refs.some(ref => ref.paragraphId === source.id && ref.id === r.id));
    if (originals.length) part[boundary] = boundary === 'start' ? Math.min(...originals.map(r => r.start)) : Math.max(...originals.map(r => r.end));
  }
  const ids = new Set([...refs.map(r => r.paragraphId), ...mapped.map(r => r.paragraphId)]);
  const updates = [...ids].map(paragraphId => {
    const p = state.task.paragraphs.find(p => p.id === paragraphId);
    const deleted = refs.filter(r => r.paragraphId === paragraphId && r.side !== 'translation').map(r => r.id);
    const highlights = p.highlights.original.filter(r => !deleted.includes(r.id));
    for (const r of mapped.filter(r => r.paragraphId === paragraphId)) highlights.push({ id: crypto.randomUUID(), start: r.start, end: r.end, kind: 'user' });
    return { paragraphId, side: 'original', highlights };
  });
  for (const paragraphId of new Set(refs.filter(r => r.side === 'translation').map(r => r.paragraphId))) {
    const p = state.task.paragraphs.find(p => p.id === paragraphId);
    updates.push({ paragraphId, side: 'translation', highlights: p.highlights.translation.filter(r => !refs.some(ref => ref.side === 'translation' && ref.paragraphId === paragraphId && ref.id === r.id)) });
  }
  return updates;
}

async function handleReaderClick(event) {
  if (event.target.closest(".range-handle")) return;
  if (handleTranslatedHighlightClick(event)) return;
  const deleteButton = event.target.closest(".highlight-delete");
  const mark = event.target.closest(".highlight");
  if (deleteButton && mark) {
    event.stopPropagation();
    const selection = selectionFromMark(mark);
    const { paragraph, ranges } = currentParagraphAndRanges(selection);
    await saveHighlights(paragraph, selection.side, ranges.filter((r) => r.id !== mark.dataset.highlightId));
    refreshHighlightDisplay([paragraph.id]);
    return;
  }
  if (!mark || !window.getSelection()?.isCollapsed) return;
  const selection = selectionFromMark(mark);
  const rect = mark.getBoundingClientRect();
  state.selection = { ...selection, menuX: Math.max(8, Math.min(innerWidth - 150, rect.left)), menuY: Math.max(68, Math.min(innerHeight - 48, rect.top - 47)) };
  document.querySelectorAll(".highlight.editing").forEach((node) => node.classList.remove("editing"));
  mark.classList.add("editing");
  state.explanation = null;
  renderFloatingOnly();
}

function offsetFromPoint(container, x, y) {
  const caret = document.caretRangeFromPoint?.(x, y);
  if (!caret || !container.contains(caret.startContainer)) return null;
  const prefix = document.createRange();
  prefix.selectNodeContents(container);
  prefix.setEnd(caret.startContainer, caret.startOffset);
  return prefix.toString().length + Number(container.dataset.textStart || 0);
}

function domTextRange(container, start, end) {
  const base = Number(container.dataset.textStart || 0);
  start -= base; end -= base;
  if (start < 0 || end <= start || end > container.textContent.length) return;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let position = 0;
  let startNode = null;
  let startOffset = 0;
  let endNode = null;
  let endOffset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const next = position + node.data.length;
    if (!startNode && start >= position && start <= next) { startNode = node; startOffset = start - position; }
    if (!endNode && end >= position && end <= next) { endNode = node; endOffset = end - position; break; }
    position = next;
  }
  if (!startNode || !endNode) return;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function selectVisualRange(container, start, end) {
  const range = domTextRange(container, start, end);
  if (!range) return;
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function handleRangeDrag(event) {
  const handle = event.target.closest(".range-handle");
  if (!handle) return;
  event.preventDefault();
  event.stopPropagation();
  const mark = handle.closest(".highlight");
  const container = mark.closest(".paragraph-text");
  const originalSelection = selectionFromMark(mark);
  let start = originalSelection.start;
  let end = originalSelection.end;
  const move = (moveEvent) => {
    const offset = offsetFromPoint(container, moveEvent.clientX, moveEvent.clientY);
    if (offset == null) return;
    if (handle.dataset.boundary === "start") start = Math.min(offset, end - 1);
    else end = Math.max(offset, start + 1);
    selectVisualRange(container, start, end);
    if(originalSelection.side === "original") { state.highlightPreview={paragraphId:originalSelection.paragraphId,id:mark.dataset.highlightId,start,end}; updateLinkedHighlights(); }
  };
  const up = async () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    const { paragraph, ranges } = currentParagraphAndRanges(originalSelection);
    const next = ranges.map((range) => range.id === mark.dataset.highlightId ? { ...range, start, end, kind: "user" } : range);
    await saveHighlights(paragraph, originalSelection.side, next);
    window.getSelection()?.removeAllRanges();
    state.selection = null;
    state.highlightPreview=null;
    refreshHighlightDisplay([paragraph.id]);
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up, { once: true });
}

function selectionFromMark(mark) {
  const paragraph = state.task.paragraphs.find((p) => p.id === mark.dataset.paragraphId);
  const side = mark.dataset.side;
  const start = Number(mark.dataset.start);
  const end = Number(mark.dataset.end);
  return { paragraphId: paragraph.id, side, start, end, highlightIds: [mark.dataset.highlightId], text: paragraph[side].slice(start, end) };
}

function cardPosition(selection) {
  const menu = document.querySelector("#selection-menu");
  const rect = menu?.getBoundingClientRect() || { left: selection.menuX, bottom: selection.menuY + 42 };
  return { x: Math.max(10, Math.min(innerWidth - 400, rect.left)), y: Math.max(70, Math.min(innerHeight - 390, rect.bottom + 8)) };
}

async function startExplanation(selection) {
  if (!selection) return;
  clearPdfSelectionPreview();
  const position = cardPosition(selection);
  state.selection = null;
  state.explanation = { selection, ...position, loading: true, answer: "" };
  state.explainHistory = [];
  window.getSelection()?.removeAllRanges();
  renderFloatingOnly();
  await requestExplanation("");
}

async function requestExplanation(question) {
  const info = state.explanation;
  if (!info) return;
  info.loading = true;
  renderFloatingOnly();
  try {
    const result = await api("/api/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: state.task.id,
        paragraphId: info.selection.paragraphId,
        side: info.selection.side,
        selection: info.selection.text,
        question,
        history: state.explainHistory,
      }),
    });
    info.answer = result.answer;
    info.loading = false;
    if (state.explanation !== info) return;
    if (question) state.explainHistory.push({ question, answer: result.answer });
    renderFloatingOnly();
  } catch (error) {
    info.answer = error.message;
    info.loading = false;
    if (state.explanation !== info) return;
    renderFloatingOnly();
  }
}

function followUpExplanation(event) {
  event.preventDefault();
  const input = event.currentTarget.querySelector("input");
  const question = input.value.trim();
  if (question) requestExplanation(question);
}

function updateScrollProgress() {
  const scroll = document.querySelector("#reading-scroll");
  const thumb = document.querySelector("#scroll-thumb");
  if (!scroll || !thumb || !state.task || !state.textReady) return;
  const max = Math.max(1, scroll.scrollHeight - scroll.clientHeight);
  const percent = Math.max(0, Math.min(100, (scroll.scrollTop / max) * 100));
  const thumbHeight = Math.max(28, (scroll.clientHeight / scroll.scrollHeight) * scroll.clientHeight);
  thumb.style.height = `${thumbHeight}px`;
  thumb.style.top = `${(percent / 100) * (scroll.clientHeight - thumbHeight)}px`;
  const rows = [...document.querySelectorAll(".paragraph-row")];
  const line = scroll.getBoundingClientRect().top + textReadingLine(scroll);
  const visible = rows.find((row) => row.getBoundingClientRect().bottom > line) || rows.at(-1);
  if (visible) {
    state.currentParagraph = visible.dataset.paragraphId;
    const rect = visible.getBoundingClientRect();
    state.textPosition = { paragraphId: state.currentParagraph, fraction: Math.max(0, Math.min(1, (line - rect.top) / Math.max(1, rect.height))),
      ...(scroll.scrollTop <= 1 ? { edge: "start" } : scroll.scrollTop >= max - 1 ? { edge: "end" } : {}) };
    const progress = readingStore.record(state.task, { kind: "text", position: state.textPosition, view: state.view, scale: 1, pageWidth: null });
    document.querySelector("#footer-percent").textContent = `${progress?.percent ?? Math.round(percent)}%`;
    document.querySelector("#footer-progress").style.width = `${progress?.percent ?? percent}%`;
    document.querySelector("#footer-position").textContent = readerProgressLabel(state.task, percent);
    document.querySelectorAll(".toc-item").forEach((item) => item.classList.toggle("active", item.dataset.jump === state.currentParagraph));
  }
}

function setupScrollThumb() {
  const thumb = document.querySelector("#scroll-thumb");
  const scroll = document.querySelector("#reading-scroll");
  if (!thumb || !scroll) return;
  thumb.onpointerdown = (event) => {
    event.preventDefault();
    thumb.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startTop = scroll.scrollTop;
    const scale = (scroll.scrollHeight - scroll.clientHeight) / Math.max(1, scroll.clientHeight - thumb.offsetHeight);
    thumb.onpointermove = (move) => { scroll.scrollTop = startTop + (move.clientY - startY) * scale; };
    thumb.onpointerup = () => { thumb.onpointermove = null; };
  };
}

function highlightedParagraphs(task) {
  return task.paragraphs.filter((p) => (p.highlights.original?.length || 0) + (p.highlights.translation?.length || 0) > 0);
}

function validTargetLength(target) {
  if (Number.isInteger(target) && target > 0 && target <= 20000) return true;
  toast("目标字数需要在 1–20000 之间");
  document.querySelector("#target-length")?.focus();
  return false;
}

function isGeneratingSummary(task) {
  return state.generating.has(task?.id) || task?.summaryProgress?.status === 'generating';
}
function showSummaryOptions() {
  const task=state.task;
  if(isGeneratingSummary(task))return go('summary',task.id);
  if(!highlightedParagraphs(task).length)return toast('请先留下一些重点');
  document.querySelector('.summary-options')?.remove();
  const dialog=document.createElement('dialog');dialog.className='summary-options';dialog.setAttribute('aria-label','生成摘要设置');
  const options=task.summaryOptions || task.summary || {};
  dialog.innerHTML=`<form class="summary-options-content"><div class="dialog-heading"><div><span class="eyebrow">从重点到成稿</span><h2>生成摘要</h2></div><button type="button" class="close-x" aria-label="关闭摘要设置">×</button></div>
    <p class="summary-options-intro">根据你保留的 ${focusItems().length} 处重点成稿。先确定篇幅和写法。</p>
    <div class="summary-fields"><label>目标字数<input name="targetLength" id="target-length" type="number" min="1" max="20000" required value="${task.targetLength || 2000}"><small>常用 800–3000 字；证据不足时会适当缩短。</small></label>
    <label>摘要风格<select name="style"><option value="analytical" ${options.style==='analytical'?'selected':''}>分析文章 · 连贯论述</option><option value="briefing" ${options.style==='briefing'?'selected':''}>决策简报 · 结论优先</option><option value="outline" ${options.style==='outline'?'selected':''}>要点提纲 · 分条速读</option></select></label></div>
    <label class="summary-emphasis">希望侧重什么（可选）<textarea name="emphasis" maxlength="500" rows="2" placeholder="例如：主要结论、关键数据与风险">${escapeHtml(options.emphasis || '')}</textarea></label>
    <section class="style-examples summary-examples"></section>
    <div class="dialog-actions"><button type="button" class="button cancel-summary-options">取消</button><button class="button primary" type="submit">确认并生成</button></div></form>`;
  document.body.append(dialog);closeDialogOnOutside(dialog,'.summary-options-content');
  dialog.querySelector('.close-x').onclick=()=>dialog.close();dialog.querySelector('.cancel-summary-options').onclick=()=>dialog.close();
  mountStyleExamples(dialog.querySelector('.style-examples'));
  dialog.querySelector('form').onsubmit=event=>{
    event.preventDefault();if(examplesPending())return toast('请等待示范文档读取完成');
    const data=new FormData(event.currentTarget),target=Number(data.get('targetLength'));
    if(!validTargetLength(target))return;
    task.targetLength=target;task.summaryOptions={style:data.get('style'),emphasis:data.get('emphasis')};
    dialog.close();generateSummary();
  };
  dialog.showModal();
}
function summaryProgressMarkup(task) {
  const progress=task.summaryProgress || {}, saving=progress.stage==='saving';
  return `<div class="summary-paper summary-generating"><span class="eyebrow">摘要生成中</span><h2 id="summary-stage-title">${saving?'正在保存摘要':'正在根据重点撰写摘要'}</h2>
    <div class="summary-progress-track" role="progressbar" aria-label="摘要生成进度" aria-valuetext="${saving?'正在保存':'正在撰写'}"><span></span></div>
    <ol class="summary-stages"><li class="done">✓ 整理重点</li><li class="${saving?'done':'active'}">${saving?'✓':'2'} 撰写摘要</li><li class="${saving?'active':''}">3 保存成稿</li></ol>
    <p><span id="summary-elapsed">已用时 0 秒</span> · <span id="summary-progress-detail">${saving?'正在保存生成结果':'模型正在处理，完成后会自动展示。'}</span></p><p class="summary-wait-note">可以返回阅读，进度会保留。${task.targetLength || 2000} 字 · ${escapeHtml(({analytical:'分析文章',briefing:'决策简报',outline:'要点提纲'})[task.summaryOptions?.style] || '分析文章')}</p></div>`;
}
function startSummaryClock(task) {
  clearInterval(state.summaryClock);
  let ticks=0,polling=false;
  const update=async()=>{
    if(state.route!=='summary' || state.taskId!==task.id){clearInterval(state.summaryClock);return;}
    const elapsed=Math.max(0,Math.floor((Date.now()-Date.parse(task.summaryProgress?.startedAt || new Date()))/1000));
    const label=document.querySelector('#summary-elapsed');if(label)label.textContent=elapsed<60?`已用时 ${elapsed} 秒`:`已用时 ${Math.floor(elapsed/60)} 分 ${elapsed%60} 秒`;
    if(++ticks%2 || polling)return;polling=true;
    try {
      const {task:fresh}=await api(`/api/tasks/${task.id}`);
      if(state.taskId!==task.id)return;
      task.summaryProgress=fresh.summaryProgress;
      if(fresh.summaryProgress?.status==='done' || fresh.summaryProgress?.status==='failed') {
        task.summary=fresh.summary;state.generating.delete(task.id);clearInterval(state.summaryClock);
        if(state.route==='summary')renderSummary();
      } else if(fresh.summaryProgress?.stage==='saving') {
        document.querySelector('#summary-stage-title').textContent='正在保存摘要';
        document.querySelector('#summary-progress-detail').textContent='正在保存生成结果';
      }
    } catch {const detail=document.querySelector('#summary-progress-detail');if(detail)detail.textContent='暂时无法读取进度，正在重新连接…';}
    finally {polling=false;}
  };
  state.summaryClock=setInterval(update,1000);update();
}

async function generateSummary() {
  const task = state.task;
  const target = Number(task.targetLength ?? 2000);
  if (!validTargetLength(target) || isGeneratingSummary(task)) return;
  if (!highlightedParagraphs(state.task).length) return toast("请先留下一些重点");
  state.generating.add(task.id);
  task.summaryProgress={status:"generating",stage:"writing",startedAt:new Date().toISOString()};
  go("summary", task.id);
  try {
    if (await highlightOutbox.flush(task.id) === false) throw new Error("高亮还未保存，请恢复连接后再生成摘要");
    const result = await api(`/api/tasks/${task.id}/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetLength: target, ...task.summaryOptions }),
    });
    task.summaryProgress={...task.summaryProgress,status:"done",stage:"done"};
    task.summary = result.summary;
    if (state.task?.id === task.id) {state.task.summary = result.summary;state.task.summaryProgress=task.summaryProgress;}
    state.generating.delete(task.id);
    if (state.taskId === task.id && state.route === "summary") renderSummary();
    else {
      if (state.taskId === task.id) {
        const button = document.querySelector("#generate-summary");
        if (button) button.textContent = "查看摘要";
      }
      toast("摘要已生成，可从阅读页查看");
    }
  } catch (error) {
    state.generating.delete(task.id);
    task.summaryProgress={...task.summaryProgress,status:"failed",error:error.message};
    toast(error.message);
    if (state.taskId === task.id && state.route === "summary") renderSummary();
  }
}

function renderSummary() {
  state.summaryResize?.disconnect();
  const task = state.task;
  if (!task || task.id !== state.taskId) {
    app.innerHTML = `<div class="loading-screen"><div class="loading-card"><h2>打开摘要</h2><p>正在读取本地内容…</p><div class="loading-bar"><span style="width:22%"></span></div></div></div>`;
    loadTask(state.taskId);
    return;
  }
  const summary = task.summary;
  clearInterval(state.summaryClock);
  const generating = isGeneratingSummary(task);
  app.innerHTML = `<main class="summary-page"><header class="topbar"><div class="center-shell topbar-inner">${homeBrand("摘要")}<div class="topbar-actions"><span class="task-progress">目标约 ${task.targetLength || 2000} 字</span></div></div></header>
    <div class="summary-shell">
      <div class="summary-toolbar"><button class="back-link" id="summary-back">${icons.arrow} 返回阅读</button><div><button class="button" id="regenerate-summary" ${generating ? "disabled" : ""}>${summary ? "重新生成" : "生成摘要"}</button><button class="button" id="copy-summary" ${!summary || generating ? "disabled" : ""}>复制</button><button class="button" id="download-summary" ${!summary || generating ? "disabled" : ""}>下载 Markdown</button><button class="button primary" id="save-summary" ${!summary || generating ? "disabled" : ""}>保存修改</button></div></div>
      ${task.summaryProgress?.status === "failed" ? `<div class="stale-warning" role="alert">摘要未完成：${escapeHtml(task.summaryProgress.error || "请重试")}</div>` : ""}
      ${generating ? summaryProgressMarkup(task) : summary ? `${summary.stale ? `<div class="stale-warning">重点后来有过调整，这份摘要可能已经不是最新版本。确认重点后可重新生成。</div>` : ""}<article class="summary-paper"><h1 class="summary-title" id="summary-title" contenteditable="plaintext-only" role="textbox" aria-multiline="true" aria-label="摘要标题" spellcheck="false">${escapeHtml(summary.title)}</h1><textarea class="summary-content" id="summary-content" aria-label="摘要正文">${escapeHtml(summary.content)}</textarea></article>` : `<div class="summary-paper summary-generating"><h2>还没有生成摘要</h2><p>确认重点后，点击“生成摘要”。</p></div>`}
    </div></main>`;
  document.querySelector("#summary-back").onclick = () => go("reader", task.id);
  document.querySelector("#regenerate-summary").onclick = showSummaryOptions;
  if(generating)startSummaryClock(task);
  if (summary && !generating) {
    const fields = [...document.querySelectorAll('.summary-content')];
    const fit = () => fields.forEach(field => { field.style.height = '0'; field.style.height = `${field.scrollHeight + 2}px`; });
    fields.forEach(field => field.addEventListener('input', fit));
    let width = 0;
    state.summaryResize = new ResizeObserver(entries => { const next = entries[0].contentRect.width; if (next !== width) { width = next; fit(); } });
    state.summaryResize.observe(document.querySelector('.summary-paper')); fit();
    document.querySelector("#copy-summary").onclick = async () => { await navigator.clipboard.writeText(`${summaryTitleText()}\n\n${document.querySelector("#summary-content").value}`); toast("摘要已复制"); };
    document.querySelector("#download-summary").onclick = downloadSummary;
    document.querySelector("#save-summary").onclick = saveSummary;
  }
}

function summaryTitleText() {
  return document.querySelector('#summary-title').innerText.replace(/\s*\n\s*/g, ' ').trim();
}

async function saveSummary() {
  const taskId = state.task.id;
  const title = summaryTitleText();
  const content = document.querySelector("#summary-content").value;
  try {
    const result = await api(`/api/tasks/${taskId}/summary`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, content }) });
    if (state.task?.id === taskId) state.task.summary = result.summary;
    toast("修改已保存");
  } catch (error) { toast(error.message); }
}

function downloadSummary() {
  const title = summaryTitleText();
  const content = document.querySelector("#summary-content").value;
  const blob = new Blob([`# ${title}\n\n${content}\n`], { type: "text/markdown;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${title.replace(/[\\/:*?\"<>|]/g, "-") || "长文伴读摘要"}.md`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function render() {
  if (state.authChecked && !state.authenticated) { renderLogin(); return; }
  clearInterval(state.summaryClock); state.summaryClock=null;
  if (state.route !== "summary") state.summaryResize?.disconnect();
  if (state.route !== "reader") preserveReaderPosition();
  if (state.route === "home") { renderHome(); loadTasks(); }
  if (state.route === "import") renderImport();
  if (state.route === "reader") renderReader();
  if (state.route === "summary") renderSummary();
}

function restoreRouteFromHistory() {
  const parsed = parseRoute();
  if (parsed.route === state.route && parsed.id === state.taskId) return;
  stopImportProgress();
  preserveReaderPosition();
  readingStore.flush();
  if (parsed.route !== "import") state.importRun = null;
  if (parsed.route === "reader" && (state.route !== "reader" || parsed.id !== state.taskId)) state.task = null;
  state.route = parsed.route;
  state.taskId = parsed.id;
  state.selection = null;
  state.explanation = null;
  stopPolling();
  render();
}
window.addEventListener("popstate", restoreRouteFromHistory);
window.addEventListener("hashchange", restoreRouteFromHistory);

const initial = parseRoute();
state.route = initial.route;
state.taskId = initial.id;
boot();

document.addEventListener("copy", (event) => {
  if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable]")) return;
  if (!(state.selection?.highlightIds?.length || state.selection?.sourceRefs?.length || state.selection?.pdfPointerSelection) || !window.getSelection()?.isCollapsed) return;
  event.clipboardData.setData("text/plain", state.selection.text);
  event.preventDefault();
});

window.addEventListener("pagehide", () => {
  preserveReaderPosition();
  readingStore.flush(undefined, { keepalive: true });
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    if (state.textReady) updateScrollProgress();
    if (state.pdfScrollSync) saveReadingState();
    readingStore.flush(undefined, { keepalive: true });
  }
});
window.addEventListener("online", () => { readingStore.flush(); highlightOutbox.flush(); });
window.setInterval(() => {
  if (document.visibilityState === "visible") { readingStore.flush(); highlightOutbox.flush(); }
}, 15000);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) render();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") dismissSelection();
});
document.addEventListener("pointerdown", (event) => {
  if (state.selection && !state.translationDragging && !event.target.closest("#selection-menu, #explain-card, #focus-navigation, .pdf-highlight-group, .highlight, .translation-range-handle")) dismissSelection();
}, { capture: true });
