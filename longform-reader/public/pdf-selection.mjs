// PDF selection is anchored to source spans, never to the first matching quote.
export function indexPdfTextSpans(layer) {
  let sourceIndex = 0;
  for (let index = 0; index < layer.textDivs.length; index += 1) {
    if (!String(layer.textContentItemsStr[index] || "").trim()) continue;
    layer.textDivs[index].dataset.sourceIndex = String(sourceIndex++);
  }
}

function textPoint(root, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let last;
  while (walker.nextNode()) {
    last = walker.currentNode;
    if (remaining <= last.length) return { node: last, offset: remaining };
    remaining -= last.length;
  }
  return last ? { node: last, offset: last.length } : null;
}

function sourceSpan(textLayer, segment) {
  const span = textLayer.querySelector(`[data-source-index="${segment.sourceIndex}"]`);
  if (!span) return null;
  const raw = span.textContent;
  let offset = segment.sourceStart || 0;
  if (raw.slice(offset, offset + segment.text.length) !== segment.text) {
    // Older saved tasks omitted leading PDF whitespace from sourceStart.
    offset = raw.indexOf(segment.text);
  }
  return offset < 0 ? null : { span, offset };
}

export function segmentDomRange(textLayer, segment, start, end) {
  const source = sourceSpan(textLayer, segment);
  if (!source) return null;
  const left = Math.max(segment.start, start);
  const right = Math.min(segment.end, end);
  if (right <= left) return null;
  const a = textPoint(source.span, source.offset + left - segment.start);
  const b = textPoint(source.span, source.offset + right - segment.start);
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

function offsetWithin(span, node, offset) {
  const prefix = document.createRange();
  prefix.selectNodeContents(span);
  prefix.setEnd(node, offset);
  return prefix.toString().length;
}

export function selectionFromPdfRange(paragraphs, textLayer, selectionRange) {
  const matches = [];
  for (const paragraph of paragraphs) {
    let start = Infinity;
    let end = -Infinity;
    for (const segment of paragraph.sourceSegments || []) {
      const source = sourceSpan(textLayer, segment);
      if (!source || !selectionRange.intersectsNode(source.span)) continue;
      const localStart = source.span.contains(selectionRange.startContainer)
        ? offsetWithin(source.span, selectionRange.startContainer, selectionRange.startOffset) : 0;
      const localEnd = source.span.contains(selectionRange.endContainer)
        ? offsetWithin(source.span, selectionRange.endContainer, selectionRange.endOffset) : source.span.textContent.length;
      const a = segment.start + Math.max(0, localStart - source.offset);
      const b = segment.start + Math.min(segment.end - segment.start, localEnd - source.offset);
      if (b <= a) continue;
      start = Math.min(start, a);
      end = Math.max(end, b);
    }
    if (end > start) matches.push({ paragraphId: paragraph.id, side: "original", start, end, text: paragraph.original.slice(start, end) });
  }
  return matches;
}

// Measure actual glyph boundaries, including proportional fonts and PDF transforms.
const caretGeometry = new WeakMap();
export function pdfOffsetFromPoint(paragraph, textLayer, x, y) {
  const layerRect = textLayer.getBoundingClientRect();
  let paragraphs = caretGeometry.get(textLayer);
  if (!paragraphs) { paragraphs = new Map(); caretGeometry.set(textLayer, paragraphs); }
  let glyphs = paragraphs.get(paragraph.id);
  if (!glyphs) {
    glyphs = [];
    for (const segment of paragraph.sourceSegments || []) {
      for (let start = segment.start; start < segment.end;) {
        const end = start + (paragraph.original.codePointAt(start) > 0xffff ? 2 : 1);
        for (const rect of segmentDomRange(textLayer, segment, start, end)?.getClientRects() || []) {
          if (rect.width && rect.height) glyphs.push({ start, end, left: rect.left - layerRect.left, right: rect.right - layerRect.left, top: rect.top - layerRect.top, bottom: rect.bottom - layerRect.top });
        }
        start = end;
      }
    }
    paragraphs.set(paragraph.id, glyphs);
  }
  x -= layerRect.left;
  y -= layerRect.top;
  let nearest = null;
  for (const rect of glyphs) {
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    const distance = Math.hypot(dx, dy);
    if (!nearest || distance < nearest.distance) {
      nearest = { distance, offset: x < (rect.left + rect.right) / 2 ? rect.start : rect.end };
    }
  }
  return nearest?.offset ?? null;
}

// Browser caret hit-testing in an absolutely positioned PDF text layer can
// jump to another column when the pointer lands in a line gap or margin.
export function pdfSelectionPoint(paragraphs, textLayer, x, y) {
  let nearest;
  for (const paragraph of paragraphs) {
    for (const segment of paragraph.sourceSegments || []) {
      for (const rect of segmentDomRange(textLayer, segment, segment.start, segment.end)?.getClientRects() || []) {
        const dx = Math.max(rect.left - x, 0, x - rect.right);
        const dy = Math.max(rect.top - y, 0, y - rect.bottom);
        const distance = Math.hypot(dx, dy);
        if (!nearest || distance < nearest.distance) nearest = { paragraph, distance };
      }
    }
  }
  if (!nearest || nearest.distance > 24) return null;
  const offset = pdfOffsetFromPoint(nearest.paragraph, textLayer, x, y);
  return offset == null ? null : { paragraphId: nearest.paragraph.id, offset };
}

export function pdfSelectionBetween(paragraphs, a, b) {
  let first = paragraphs.findIndex(p => p.id === a.paragraphId);
  let last = paragraphs.findIndex(p => p.id === b.paragraphId);
  if (first < 0 || last < 0) return [];
  if (first > last || (first === last && a.offset > b.offset)) {
    [first, last] = [last, first];
    [a, b] = [b, a];
  }
  return paragraphs.slice(first, last + 1).map((p, i, selected) => {
    const start = i === 0 ? a.offset : 0;
    const end = i === selected.length - 1 ? b.offset : p.original.length;
    return { paragraphId: p.id, side: "original", start, end, text: p.original.slice(start, end) };
  }).filter(item => item.text.trim());
}

export function renderOcrTextLayer(textLayer, paragraphs, width, height) {
  textLayer.classList.add("ocr-text-layer");
  const measure = document.createElement("canvas").getContext("2d");
  for (const paragraph of paragraphs) {
    for (const segment of paragraph.sourceSegments || []) {
      if (!segment.ocr || !segment.rect) continue;
      const line = document.createElement("span");
      line.className = "ocr-source-segment";
      line.dataset.sourceIndex = String(segment.sourceIndex);
      let offset = segment.start;
      let glyphs = segment.glyphs || [];
      const covered = new Set(glyphs.flatMap((glyph) => Array.from({ length: glyph.end - glyph.start }, (_, index) => glyph.start + index)));
      const complete = [...Array(segment.end - segment.start).keys()].every((index) => /\s/.test(paragraph.original[segment.start + index]) || covered.has(segment.start + index));
      if (!glyphs.length || !complete) glyphs = [{ start: segment.start, end: segment.end, rect: segment.rect }];
      for (const glyph of glyphs) {
        if (glyph.start > offset) line.append(document.createTextNode(paragraph.original.slice(offset, glyph.start)));
        const text = paragraph.original.slice(glyph.start, glyph.end);
        const span = document.createElement("span");
        span.className = "ocr-glyph";
        span.textContent = text;
        const fontSize = Math.max(1, glyph.rect.height * height);
        measure.font = `${fontSize}px sans-serif`;
        span.style.left = `${glyph.rect.left * width}px`;
        span.style.top = `${glyph.rect.top * height}px`;
        span.style.fontSize = `${fontSize}px`;
        span.style.transform = `scaleX(${glyph.rect.width * width / Math.max(0.1, measure.measureText(text).width)})`;
        line.append(span);
        offset = glyph.end;
      }
      if (offset < segment.end) line.append(document.createTextNode(paragraph.original.slice(offset, segment.end)));
      textLayer.append(line);
    }
  }
}
