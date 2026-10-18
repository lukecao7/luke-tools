// Presentation never inserts characters into saved translations: annotations
// and sentence alignment continue to use the original offsets.
export function translationDisplayText(paragraph) {
  const text = paragraph.translation || paragraph.original || '';
  const number = paragraph.original?.match(/^(\d+(?:\.\d+)*\.?|[A-Z](?:\.\d+)*\.)\s+(?=\S)/)?.[1];
  if (!number) return text;
  const prefix = text.slice(0, number.length);
  return prefix.replace(/[。．]/g, '.') === number ? number + text.slice(number.length) : text;
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
      if (!(i === 0 && sourceId !== paragraph.id || previous && (indented && separated || bullet || explicitBreak))) continue;
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
