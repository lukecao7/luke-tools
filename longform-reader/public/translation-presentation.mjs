// Presentation never inserts characters into saved translations: annotations
// and sentence alignment continue to use the original offsets.
import { bounds, projectAlignedRange } from './document-translation.mjs';

export function translationDisplayText(paragraph) {
  const text = paragraph.translation || paragraph.original || '';
  const number = paragraph.original?.match(/^(\d+(?:\.\d+)*\.?|[A-Z](?:\.\d+)*\.)\s+(?=\S)/)?.[1];
  if (!number) return text;
  const prefix = text.slice(0, number.length);
  return prefix.replace(/[。．]/g, '.') === number ? number + text.slice(number.length) : text;
}

// A translated sentence may cover more than one extracted source block. Place
// it once, on the page holding most of that sentence; later sentences follow
// their own source pages. Saved strings and annotation offsets never change.
export function translationFragments(paragraph, task, { mathIds = new Set() } = {}) {
  const text = paragraph.translation || paragraph.original || '';
  const byId = new Map(task.paragraphs.map(p => [p.id, p]));
  const all = paragraph.translationAlignment || [];
  const aligned = [...new Map(all.map(a => [`${a.start}:${a.end}`, a]).reverse()).values()].map(a => {
    const parts = all.filter(b => b.start === a.start && b.end === a.end && !mathIds.has(b.sourceParagraphId));
    // A sentence with only a few words before a page break belongs to the page
    // containing most of that sentence, rather than spilling the next page up.
    return parts.sort((x, y) => (y.sourceEnd - y.sourceStart) - (x.sourceEnd - x.sourceStart))[0] || a;
  }).sort((a, b) => a.start - b.start);
  const suppressed = [];
  for (const id of paragraph.translationMembers || [paragraph.id]) {
    if (!mathIds.has(id)) continue;
    const original = byId.get(id)?.original.trim();
    if (!original) continue;
    const at = text.indexOf(original);
    if (at >= 0 && text.indexOf(original, at + 1) < 0) suppressed.push({ start: at, end: at + original.length });
  }
  for (const a of aligned) if (all.filter(b => b.start === a.start && b.end === a.end).every(b => mathIds.has(b.sourceParagraphId))) suppressed.push({ start: a.start, end: a.end });
  const blocks = translationBlocks(paragraph, task);
  const starts = new Set(blocks.map(b => b.start));
  suppressed.forEach(r => { starts.add(r.start); starts.add(r.end); });
  let previousPage = paragraph.pageNumber;
  for (const a of aligned) {
    const pageNumber = byId.get(a.sourceParagraphId)?.pageNumber || previousPage;
    if (pageNumber !== previousPage) starts.add(a.start);
    previousPage = pageNumber;
  }
  const offsets = [...starts].filter(n => n >= 0 && n < text.length).sort((a, b) => a - b);
  return offsets.map((start, index) => {
    const end = offsets[index + 1] ?? text.length;
    if (suppressed.some(r => r.start <= start && r.end >= end) || !text.slice(start, end).trim()) return null;
    const first = aligned.find(a => a.end > start);
    const source = byId.get(first?.sourceParagraphId) || paragraph;
    const pageNumber = source.pageNumber;
    const segments = [];
    for (const a of aligned.filter(a => a.start < end && a.end > start)) {
      const p = byId.get(a.sourceParagraphId);
      if (!p || p.pageNumber !== pageNumber) continue;
      const r = suppressed.some(r => r.start < a.end && r.end > a.start)
        ? { start: a.sourceStart, end: a.sourceEnd }
        : projectAlignedRange({ sourceStart: a.start, sourceEnd: a.end, start: a.sourceStart, end: a.sourceEnd }, start, end);
      segments.push(...(p.sourceSegments || []).filter(s => s.end > r.start && s.start < r.end));
    }
    const sourceSegments = segments.length ? [...new Set(segments)] : source.sourceSegments || [];
    const rect = bounds(sourceSegments);
    const block = blocks.find(b => b.start <= start && b.end > start) || {};
    const lines = sourceLines({ sourceSegments });
    // Full width comes from the source text column, not the short last line or
    // short heading. Narrow columns and pull quotes keep their own bounds.
    const pageLines = task.paragraphs.filter(p => p.pageNumber === pageNumber && p.translationVisible && !p.figureId && p.original.length > 120)
      .flatMap(p => sourceLines(p)).filter(l => l.text.length > 35);
    const columnLeft = pageLines.length ? Math.min(...pageLines.map(l => l.left)) : rect?.left;
    const columnRight = Math.max(...task.paragraphs.filter(p => p.pageNumber === pageNumber && p.translationVisible && !p.figureId && p.original.length > 120)
      .flatMap(p => p.sourceSegments || []).filter(s => s.rect && s.text?.length > 25).map(s => s.rect.left + s.rect.width));
    let layoutRect = rect;
    if (rect && !paragraph.pullQuote && columnRight - columnLeft > .55 && rect.left < columnLeft + .1) {
      layoutRect = { ...rect, left: columnLeft, width: columnRight - columnLeft };
    }
    const sourceIndent = lines[0] ? lines[0].left - (layoutRect?.left || 0) : 0;
    const indent = rect && !paragraph.headingLevel && !block.listItem && sourceIndent > .012 && sourceIndent < .05 ? sourceIndent : 0;
    return { start, end, pageNumber, sourceParagraphId: source.id, sourceSegments, rect: layoutRect, indent,
      ...(block.listItem ? { listItem: true } : {}), ...(block.leadEnd > start && block.leadEnd < end ? { leadEnd: block.leadEnd } : {}) };
  }).filter(Boolean);
}

export function translationHeadingLabel(paragraph) {
  return translationDisplayText(paragraph).replace(/^(\d+(?:\.\d+)*\.?|[A-Z](?:\.\d+)*\.)(?=[^\s\d.])/, '$1 ');
}

function sourceLines(paragraph) {
  const lines = [];
  for (const segment of [...(paragraph.sourceSegments || [])].filter(s => s.rect && s.text?.trim()).sort((a, b) => a.start - b.start)) {
    let line = lines.at(-1);
    if (!line || Math.abs(line.top - segment.rect.top) > Math.max(line.height, segment.rect.height) * .55) {
      line = { start: segment.start, top: segment.rect.top, left: segment.rect.left, height: segment.rect.height, text: '' };
      lines.push(line);
    }
    line.left = Math.min(line.left, segment.rect.left);
    line.text += segment.text;
  }
  return lines;
}

export function translationBlocks(paragraph, task = { paragraphs: [paragraph] }) {
  const text = paragraph.translation || paragraph.original || '';
  if (paragraph.headingLevel || paragraph.pullQuote) return [{ start: 0, end: text.length }];
  const alignments = paragraph.translationAlignment || [];
  const starts = new Set([0]);
  for (const sourceId of paragraph.translationMembers || [paragraph.id]) {
    const source = task.paragraphs.find(p => p.id === sourceId);
    if (!source) continue;
    const lines = sourceLines(source);
    const longLines = lines.filter(line => line.text.length > 25);
    const left = Math.min(...(longLines.length ? longLines : lines).map(line => line.left));
    for (const [i, line] of lines.entries()) {
      const previous = lines[i - 1];
      const indent = line.left - left;
      const separated = previous && line.top - previous.top > Math.max(previous.height, line.height) * 1.55;
      const indented = indent > .012 && indent < .085;
      const marker = source.original.slice(line.start).match(/^(?:[•●▪‣–]|\d{1,2}[.)])(?=\s|$)/)?.[0];
      const bullet = Boolean(marker);
      const explicitBreak = /\n\s*$/.test(source.original.slice(0, line.start));
      if (!(bullet || previous && (indented && separated || explicitBreak))) continue;
      // Only split at a known translated sentence boundary. Never estimate a
      // character position in Chinese from a PDF line wrap.
      const aligned = alignments.find(a => a.sourceParagraphId === sourceId && Math.abs(a.sourceStart - line.start) <= 2);
      if (aligned) starts.add(aligned.start);
      if (marker) {
        const containing = alignments.find(a => a.sourceParagraphId === sourceId && a.sourceStart <= line.start && a.sourceEnd > line.start);
        if (containing) {
          const target = text.slice(containing.start, containing.end);
          const indices = value => { const found = []; for (let at = value.indexOf(marker); at >= 0; at = value.indexOf(marker, at + marker.length)) found.push(at); return found; };
          const sourceMarkers = indices(source.original.slice(containing.sourceStart, containing.sourceEnd));
          const targetMarkers = indices(target);
          const ordinal = sourceMarkers.indexOf(line.start - containing.sourceStart);
          // Marker text is shared by both languages, including when the model
          // attached "1." or the first bullet to the introductory sentence.
          if (ordinal >= 0 && sourceMarkers.length === targetMarkers.length) starts.add(containing.start + targetMarkers[ordinal]);
        }
      }
    }
  }
  // A number-only sentence and its body remain one visual list item.
  const offsets = [...starts].filter(n => n >= 0 && n < text.length).sort((a, b) => a - b)
    .filter((offset, i, all) => !i || !/^\s*\d{1,2}[.)]\s*$/.test(text.slice(all[i - 1], offset)));
  return offsets.map((start, index) => {
    const end = offsets[index + 1] ?? text.length;
    const lead = alignments.find(a => a.start === start);
    const source = lead && task.paragraphs.find(p => p.id === lead.sourceParagraphId)?.original.slice(lead.sourceStart, lead.sourceEnd).trim();
    const runInHeading = source && source.length < 70 && source.split(/\s+/).length <= 8 && !/\b(is|are|we|our|this|these|those|it|they)\b/i.test(source)
      && /^[A-Za-z]/.test(source) && /\.$/.test(source) && lead.end - start <= 32 && lead.end < end;
    return { start, end, ...(/^(?:[•●▪‣–]|\d{1,2}[.)])/.test(text.slice(start, end)) ? { listItem: true } : {}), ...(runInHeading ? { leadEnd: lead.end } : {}) };
  });
}
