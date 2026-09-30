const views = ["compare", "original", "translation"];
const bounded = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const round = value => Math.round(value * 1e6) / 1e6;

// The same document anchor survives changes to viewport size and reading mode.
export function normalizeReadingProgress(task, value) {
  const fail = () => { throw new Error("阅读进度无效"); };
  if (!value || !views.includes(value.view) || !bounded(value.scale, .7, 1.8)) fail();
  if (typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)) || Date.parse(value.updatedAt) > Date.now() + 300000) fail();
  const p = value.position;
  if (!p || !bounded(p.fraction, 0, 1) || (p.edge !== undefined && !["start", "end"].includes(p.edge))) fail();
  const position = { fraction: round(p.fraction), ...(p.edge ? { edge: p.edge } : {}) };
  let index, total;
  if (value.kind === "pdf" && task.sourceType === "pdf" && task.sourceAvailable) {
    total = task.pageCount;
    if (!Number.isInteger(p.pageNumber) || !bounded(p.pageNumber, 1, total)) fail();
    position.pageNumber = p.pageNumber;
    index = p.pageNumber - 1;
    if (p.alignment != null) {
      const a = p.alignment;
      if (!Number.isInteger(a.pageNumber) || !bounded(a.pageNumber, 1, total) || !bounded(a.original, .0001, .9999) || !bounded(a.translation, .0001, .9999)) fail();
      if (a.translationPageNumber != null && (!Number.isInteger(a.translationPageNumber) || !bounded(a.translationPageNumber, 1, total))) fail();
      position.alignment = { pageNumber: a.pageNumber, original: round(a.original), translation: round(a.translation),
        ...(a.translationPageNumber != null ? { translationPageNumber: a.translationPageNumber } : {}) };
    }
  } else if (value.kind === "text" && !(task.sourceType === "pdf" && task.sourceAvailable)) {
    total = task.paragraphs?.length || task.paragraphCount;
    index = task.paragraphs ? task.paragraphs.findIndex(row => row.id === p.paragraphId) : p.paragraphIndex;
    if (typeof p.paragraphId !== "string" || !Number.isInteger(index) || !bounded(index, 0, total - 1)) fail();
    Object.assign(position, { paragraphId: p.paragraphId, paragraphIndex: index });
  } else fail();
  const percent = p.edge === "end" ? 100 : p.edge === "start" ? 0 : Math.min(99, Math.round((index + p.fraction) / total * 100));
  return {
    version: 1, kind: value.kind, position, view: value.view, scale: round(value.scale),
    pageWidth: bounded(value.pageWidth, 100, 20000) ? value.pageWidth : null,
    percent, updatedAt: new Date(value.updatedAt).toISOString(),
    ...(value.savedAt ? { savedAt: value.savedAt } : {}),
  };
}

const signature = progress => JSON.stringify(progress && { kind: progress.kind, position: progress.position, view: progress.view, scale: progress.scale, pageWidth: progress.pageWidth });

// Cache immediately, then coalesce disk/cloud saves. Pending writes survive a
// reload in the cache; timestamps prevent delayed requests rewinding progress.
export function createReadingProgressStore({ storage, send, onChange = () => {} }) {
  const records = new Map(), pending = new Map(), timers = new Map(), deadlines = new Map(), sending = new Set();
  const persist = (id, progress) => {
    try { storage.setItem(`reading:${id}`, JSON.stringify(progress)); return true; } catch { return false; }
  };
  function schedule(id) {
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => flush(id), 1200));
    if (!deadlines.has(id)) deadlines.set(id, setTimeout(() => flush(id), 8000));
  }
  function stopTimers(id) {
    clearTimeout(timers.get(id)); clearTimeout(deadlines.get(id));
    timers.delete(id); deadlines.delete(id);
  }
  function announce(id, progress, status) { onChange(id, progress, status); }
  function hydrate(task) {
    let cached, remote;
    try {
      cached = records.get(task.id) || JSON.parse(storage.getItem(`reading:${task.id}`) || "null");
      // Migrate the earlier PDF-only browser bookmark if no saved record exists.
      if (cached?.position?.taskId === task.id && !cached.version && !task.readingProgress) {
        cached = { ...cached, kind: "pdf", updatedAt: new Date().toISOString() };
      }
      cached = cached && normalizeReadingProgress(task, cached);
    } catch { cached = null; }
    try { remote = task.readingProgress && normalizeReadingProgress(task, task.readingProgress); } catch { remote = null; }
    const progress = cached && (!remote || cached.updatedAt > remote.updatedAt) ? cached : remote;
    if (!progress) return null;
    records.set(task.id, progress);
    const local = persist(task.id, progress);
    const unsaved = !remote || progress.updatedAt > remote.updatedAt;
    if (unsaved && task.status === "ready") { pending.set(task.id, progress); schedule(task.id); }
    announce(task.id, progress, unsaved ? (local ? "正在保存进度…" : "进度尚未保存") : "进度已保存");
    return progress;
  }
  function record(task, snapshot) {
    if (task.status !== "ready") return;
    const previous = records.get(task.id);
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(previous?.updatedAt) + 1 || 0)).toISOString();
    const progress = normalizeReadingProgress(task, { ...snapshot, updatedAt });
    if (signature(previous) === signature(progress)) return previous;
    records.set(task.id, progress);
    const local = persist(task.id, progress);
    pending.set(task.id, progress);
    schedule(task.id);
    announce(task.id, progress, local ? "正在保存进度…" : "进度尚未保存");
    return progress;
  }
  async function flush(id, { keepalive = false } = {}) {
    if (id === undefined) return Promise.all([...pending.keys()].map(key => flush(key, { keepalive })));
    stopTimers(id);
    const progress = pending.get(id);
    if (!progress || (sending.has(id) && !keepalive)) return;
    sending.add(id);
    try {
      const saved = await send(id, progress, { keepalive });
      // An older response must not replace movement that happened in flight.
      if (records.get(id)?.updatedAt <= saved.updatedAt) {
        records.set(id, saved); persist(id, saved); pending.delete(id);
        announce(id, saved, "进度已保存");
      }
    } catch {
      const latest = records.get(id);
      const local = persist(id, latest);
      announce(id, latest, local ? "进度已暂存，等待同步" : "进度未保存，请保持页面打开");
    } finally {
      sending.delete(id);
      if (pending.get(id) && pending.get(id) !== progress) schedule(id);
    }
  }
  return { hydrate, record, flush, get: id => records.get(id) };
}
