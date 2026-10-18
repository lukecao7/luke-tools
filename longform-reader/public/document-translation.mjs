import { translationDisplayText } from './translation-presentation.mjs';

// Source paragraphs and offsets stay immutable. Translation units may span PDF pages.
export function bounds(segments) {
  const rects = segments.map(s => s.rect).filter(Boolean);
  if (!rects.length) return null;
  const left = Math.min(...rects.map(r => r.left)), top = Math.min(...rects.map(r => r.top));
  return { left, top, width: Math.max(...rects.map(r => r.left + r.width)) - left, height: Math.max(...rects.map(r => r.top + r.height)) - top };
}

export function sentenceParts(text) {
  const segmenter = new Intl.Segmenter(/[\u3400-\u9fff]/.test(text) ? "zh" : "en", { granularity: "sentence" });
  return [...segmenter.segment(text)].filter(s => s.segment.trim()).map((s, i) => ({ id: `s${i + 1}`, start: s.index, end: s.index + s.segment.trimEnd().length, text: s.segment.trimEnd() }));
}

export function continuationGroups(paragraphs) {
  const body = paragraphs.filter(p => p.translationVisible && !p.figureId && !p.headingLevel);
  const joins = new Map();
  for (const p of body) {
    const box = bounds(p.sourceSegments || []);
    if (!box || /[.!?。！？:：;；][”’"')\]]*\s*$/.test(p.original)) continue;
    const nextInOrder = paragraphs.filter(q => q.translationVisible && !q.figureId && q.index > p.index).sort((a, b) => a.index - b.index)[0];
    if (nextInOrder?.pageNumber === p.pageNumber && !nextInOrder.headingLevel && /^[a-z]/.test(nextInOrder.original.trim())) {
      joins.set(p.id, nextInOrder.id);
      continue;
    }
    if (box.top + box.height < .78) continue;
    // The last narrative block, then the first block on the next page. Chart
    // labels and PDF object order cannot become a prose continuation.
    const samePage = body.filter(q => q.pageNumber === p.pageNumber);
    if (samePage.some(q => q.index > p.index && (bounds(q.sourceSegments || [])?.top ?? 1) > box.top)) continue;
    const next = body.filter(q => q.pageNumber === p.pageNumber + 1)
      .sort((a, b) => (bounds(a.sourceSegments || [])?.top ?? 1) - (bounds(b.sourceSegments || [])?.top ?? 1) || a.index - b.index)[0];
    const nextBox = next && bounds(next.sourceSegments || []);
    if (!nextBox || nextBox.top > .18 || !/^[a-z]/.test(next.original.trim())) continue;
    joins.set(p.id, next.id);
  }
  const children = new Set(joins.values()), byId = new Map(paragraphs.map(p => [p.id, p]));
  return body.filter(p => !children.has(p.id)).map(p => {
    const members = [p];
    while (joins.has(members.at(-1).id)) members.push(byId.get(joins.get(members.at(-1).id)));
    return members;
  }).filter(members => members.length > 1);
}

export function prepareTranslationGroups(task) {
  const groups = continuationGroups(task.paragraphs);
  const previousMembers = new Map(task.paragraphs.map(p => [p.id, JSON.stringify(p.translationMembers || [p.id])]));
  for (const p of task.paragraphs) { delete p.translationContinuationOf; delete p.translationMembers; }
  for (const members of groups) {
    members[0].translationMembers = members.map(p => p.id);
    if (previousMembers.get(members[0].id) !== JSON.stringify(members[0].translationMembers)) members[0].translationAligned = false;
    for (const p of members.slice(1)) p.translationContinuationOf = members[0].id;
  }
  return groups;
}

export function figureRegions(paragraphs, descriptions = []) {
  const byId = new Map(paragraphs.map(p => [p.id, p]));
  const assigned = new Set();
  return descriptions.flatMap((description, index) => {
    const blocks = [...new Set(description.block_ids || [])].map(id => byId.get(id))
      .filter(p => p && p.pageNumber === description.page && !assigned.has(p.id));
    const box = bounds(blocks.flatMap(p => p.sourceSegments || []));
    if (!box || !blocks.some(p => /[A-Za-z]/.test(p.original))) return [];
    blocks.forEach(p => assigned.add(p.id));
    let left = Math.max(.025, box.left - .02), right = Math.min(.975, box.left + box.width + .035);
    if (right < .505) { left = .035; right = .49; }
    else if (left > .49) { left = .505; right = .965; }
    const top = Math.max(.035, box.top - .02), bottom = Math.min(.945, box.top + box.height + .045);
    const labels = blocks.flatMap(p => {
      const lines = [];
      for (const segment of p.sourceSegments || []) {
        let line = lines.find(l => Math.abs(l[0].rect.top - segment.rect.top) < segment.rect.height * .45);
        if (!line) lines.push(line = []);
        line.push(segment);
      }
      lines.sort((a, b) => a[0].rect.top - b[0].rect.top);
      const groups = [];
      for (const line of lines) {
        const previous = groups.at(-1)?.at(-1)?.at(-1);
        if (!previous || line[0].rect.top - previous.rect.top > Math.max(line[0].rect.height, previous.rect.height) * 1.7) groups.push([]);
        groups.at(-1).push(line);
      }
      return groups.map((group, i) => {
        const segments = group.flat().sort((a, b) => a.start - b.start);
        const start = Math.min(...segments.map(s => s.start)), end = Math.max(...segments.map(s => s.end));
        return { id: `label-${p.id}-${i}`, paragraphId: p.id, sourceStart: start, sourceEnd: end,
          original: p.original.slice(start, end), rect: bounds(segments), sourceSegments: segments,
          translation: !/[A-Za-z]/.test(p.original.slice(start, end)) ? p.original.slice(start, end) : "" };
      });
    });
    const joinedLabels = [];
    for (const label of labels.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)) {
      label.sources = [{ paragraphId: label.paragraphId, start: label.sourceStart, end: label.sourceEnd }];
      const previous = /^[a-z]/.test(label.original.trim()) && [...joinedLabels].reverse().find(p => {
        const lineHeight = Math.max(...p.sourceSegments.map(s => s.rect.height), label.rect.height);
        const bottom = p.rect.top + p.rect.height, gap = label.rect.top - bottom;
        const aligned = Math.abs(p.rect.left - label.rect.left) < .015 || Math.abs(p.rect.left + p.rect.width - label.rect.left - label.rect.width) < .015;
        return /[A-Za-z]$/.test(p.original.trim()) && gap >= -.002 && gap < lineHeight * .65 && aligned;
      });
      if (previous) {
        previous.original += ` ${label.original}`;
        previous.sourceSegments.push(...label.sourceSegments);
        previous.sources.push(...label.sources);
        previous.rect = bounds(previous.sourceSegments);
        previous.translation = "";
      } else joinedLabels.push(label);
    }
    return [{ id: `figure-${description.page}-${index + 1}`, pageNumber: description.page, blockIds: blocks.map(p => p.id), rect: { left, top, width: right - left, height: bottom - top }, labels: joinedLabels }];
  });
}

export function translationUnits(task, { realign = false } = {}) {
  const byId = new Map(task.paragraphs.map(p => [p.id, p]));
  const units = task.paragraphs.filter(p => p.translationVisible && !p.figureId && !p.translationContinuationOf)
    .filter(p => p.status !== "done" || p.translationMembers?.length > 1 && !p.translationAligned || realign && !p.translationAligned)
    .map(p => {
      const members = (p.translationMembers || [p.id]).map(id => byId.get(id));
      let text = "";
      const sources = members.map(member => {
        if (text) text += " ";
        const start = text.length; text += member.original;
        return { id: member.id, start, end: text.length };
      });
      return { id: p.id, original: text, language: p.language, sources, parts: sentenceParts(text),
        existingTranslation: members.length === 1 && p.status === "done" ? p.translation : "" };
    });
  const labels = task.figures?.flatMap(f => f.labels).filter(l => !l.translation) || [];
  const unique = new Map();
  for (const label of labels) {
    const key = label.original.trim().replace(/\s+/g, " ");
    if (unique.has(key)) { unique.get(key).labelIds.push(label.id); continue; }
    const unit = { id: label.id, original: label.original, language: "en", kind: "chart", labelIds: [label.id], parts: [{ id: "s1", start: 0, end: label.original.length, text: label.original }] };
    units.push(unit); unique.set(key, unit);
  }
  return units;
}

// Required object keys constrain every source sentence, unlike an array whose
// shape is valid even when the model skips an ID or merges two sentences.
export function translationSchema(units) {
  const object = properties => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
  return object({ translations: object(Object.fromEntries(units.map(unit => [unit.id,
    object(Object.fromEntries(unit.parts.map(part => [part.id, { type: "string", pattern: "\\S" }])))
  ]))) });
}

export function translationResults(response) {
  if (response?.translations && typeof response.translations === "object" && !Array.isArray(response.translations)) {
    return new Map(Object.entries(response.translations).map(([id, parts]) => [id, { segments:
      parts && typeof parts === "object" && !Array.isArray(parts) ? Object.entries(parts).map(([id, translation]) => ({ id, translation })) : []
    }]));
  }
  // Compatibility with saved responses and existing local test providers.
  return new Map((Array.isArray(response?.results) ? response.results : []).map(result => [result.id, result]));
}

export function translationIssue(unit, result) {
  const segments = result?.segments;
  if (!segments && typeof result?.translation === "string" && result.translation.trim()) return null;
  const missing = unit.parts.filter(part => !Array.isArray(segments) || !segments.some(s => s?.id === part.id && typeof s.translation === "string" && s.translation.trim())).map(p => p.id);
  const ids = Array.isArray(segments) ? segments.map(s => s?.id) : [];
  return missing.length || ids.length !== unit.parts.length || new Set(ids).size !== ids.length || ids.some(id => !unit.parts.some(p => p.id === id))
    ? { id: unit.id, missing, expected: unit.parts.length, received: ids.length } : null;
}

export function applyTranslationResult(task, unit, result) {
  const segments = result.segments;
  if (translationIssue(unit, result)) throw new Error("AI 返回的译文句子不完整");
  let translation = "";
  const alignments = [];
  for (const part of unit.parts) {
    const value = segments?.find(s => s.id === part.id)?.translation?.trim();
    if (!value) continue;
    const start = translation.length; translation += value;
    for (const source of unit.sources || []) {
      if (source.end <= part.start || source.start >= part.end) continue;
      alignments.push({ sourceParagraphId: source.id, sourceStart: Math.max(part.start, source.start) - source.start,
        sourceEnd: Math.min(part.end, source.end) - source.start, start, end: translation.length });
    }
  }
  translation ||= result.translation?.trim(); // Old saved responses and controlled test providers.
  if (!translation) throw new Error("AI 没有返回有效译文");
  if (unit.kind === "chart") {
    for (const label of task.figures.flatMap(f => f.labels)) if (unit.labelIds.includes(label.id)) label.translation = translation;
  } else {
    const paragraph = task.paragraphs.find(p => p.id === unit.id);
    paragraph.translation = translationDisplayText({ original: unit.original, translation });
    paragraph.translationAlignment = alignments;
    paragraph.translationAligned = alignments.length > 0;
    for (const source of unit.sources) task.paragraphs.find(p => p.id === source.id).status = "done";
  }
}

export function linkedTranslationRanges(task, paragraphId, start, end) {
  const source = task.paragraphs.find(p => p.id === paragraphId);
  const target = task.paragraphs.find(p => p.id === (source?.translationContinuationOf || paragraphId));
  const alignments = target?.translationAlignment?.length ? target.translationAlignment
    : target?.translation && source?.id === target.id ? [{ sourceParagraphId: source.id, sourceStart: 0, sourceEnd: source.original.length, start: 0, end: target.translation.length }] : [];
  return { paragraphId: target?.id, ranges: alignments
    .filter(a => a.sourceParagraphId === paragraphId && a.sourceEnd > start && a.sourceStart < end)
    .map(a => projectAlignedRange(a, start, end)) };
}

// Sentence boundaries come from the translation response. Within a sentence,
// interpolate the selected span; this is a visual estimate, not word alignment.
export function projectAlignedRange(alignment, start, end) {
  const { sourceStart, sourceEnd } = alignment;
  const length = Math.max(1, sourceEnd - sourceStart);
  const targetLength = alignment.end - alignment.start;
  const left = Math.max(0, Math.min(1, (start - sourceStart) / length));
  const right = Math.max(left, Math.min(1, (end - sourceStart) / length));
  const targetStart = alignment.start + Math.floor(left * targetLength);
  return { start: targetStart, end: Math.min(alignment.end, Math.max(targetStart + 1, alignment.start + Math.ceil(right * targetLength))) };
}
