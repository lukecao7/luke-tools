import { projectAlignedRange } from './document-translation.mjs';

// One annotation lives at its source location. Both views edit that same record.
export function translationUnit(task, { paragraphId, labelId }, quotes = []) {
  if (labelId) {
    const label = (task.figures || []).flatMap(f => f.labels).find(l => l.id === labelId);
    if (!label) return null;
    const text = label.translation || label.original;
    const sources = label.sources || [{ paragraphId: label.paragraphId, start: label.sourceStart, end: label.sourceEnd }];
    const total = sources.reduce((n, s) => n + s.end - s.start, 0);
    let offset = 0;
    return { text, alignments: sources.map(s => {
      const start = Math.round(offset / total * text.length); offset += s.end - s.start;
      return { sourceParagraphId: s.paragraphId, sourceStart: s.start, sourceEnd: s.end, start, end: Math.round(offset / total * text.length) };
    }) };
  }
  const paragraph = quotes.find(p => p.id === paragraphId) || task.paragraphs.find(p => p.id === paragraphId);
  if (!paragraph) return null;
  const text = paragraph.translation || paragraph.original;
  return { text, alignments: paragraph.translationAlignment?.length && !paragraph.pullQuote ? paragraph.translationAlignment : [
    { sourceParagraphId: paragraph.id, sourceStart: 0, sourceEnd: paragraph.original.length, start: 0, end: text.length },
  ] };
}

export function sourceRangesForTranslation(unit, start, end) {
  const result = [];
  for (const a of unit?.alignments || []) {
    if (a.end <= start || a.start >= end || a.end <= a.start) continue;
    const range = projectAlignedRange({ sourceStart: a.start, sourceEnd: a.end, start: a.sourceStart, end: a.sourceEnd }, start, end);
    const previous = result.at(-1);
    if (previous?.paragraphId === a.sourceParagraphId && previous.end >= range.start) previous.end = Math.max(previous.end, range.end);
    else result.push({ paragraphId: a.sourceParagraphId, ...range });
  }
  return result;
}

// Serialize writes and keep only the latest pending value per paragraph/side.
// A slow response must never replace a newer local edit. The outbox survives reloads.
export function createHighlightOutbox({ storage, send, onStatus = () => {} }) {
  const key = 'longform-highlight-outbox-v1';
  let pending = {};
  try { pending = JSON.parse(storage.getItem(key) || '{}'); } catch { /* Storage can be disabled. */ }
  const running = new Map();
  const persist = () => { try { storage.setItem(key, JSON.stringify(pending)); } catch { onStatus(null, 'storage-error'); } };
  function enqueue(id, updates) {
    const items = pending[id] ||= {};
    for (const update of updates) items[`${update.paragraphId}:${update.side}`] = structuredClone(update);
    persist(); onStatus(id, 'saving'); void flush(id);
  }
  function apply(task) {
    for (const update of Object.values(pending[task.id] || {})) {
      const paragraph = task.paragraphs.find(p => p.id === update.paragraphId);
      if (paragraph) paragraph.highlights[update.side] = structuredClone(update.highlights);
    }
    if (pending[task.id] && task.summary) task.summary.stale = true;
  }
  function flush(id) {
    if (!id) return Promise.all(Object.keys(pending).map(id => flush(id)));
    if (running.has(id)) return running.get(id);
    const job = (async () => {
      while (pending[id]) {
        const snapshot = { ...pending[id] };
        onStatus(id, 'saving');
        try { await send(id, Object.values(snapshot)); }
        catch { onStatus(id, 'pending'); return false; }
        for (const [name, value] of Object.entries(snapshot)) if (pending[id]?.[name] === value) delete pending[id][name];
        if (!Object.keys(pending[id] || {}).length) delete pending[id];
        persist();
      }
      onStatus(id, 'saved'); return true;
    })().finally(() => running.delete(id));
    running.set(id, job); return job;
  }
  return { enqueue, apply, flush, hasPending: id => Boolean(pending[id]) };
}
