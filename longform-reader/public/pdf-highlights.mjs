// Adjacent evidence quotes separated only by whitespace are one reading mark.
// Keep their saved IDs so editing/removing the group updates all its members.
export function highlightGroups(text, ranges = []) {
  const groups = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = groups.at(-1);
    if (previous && (range.start <= previous.end || !text.slice(previous.end, range.start).trim())) {
      previous.end = Math.max(previous.end, range.end);
      previous.ids.push(range.id);
    } else groups.push({ ...range, ids: [range.id] });
  }
  return groups;
}

export function mergeHighlightRects(rects) {
  const merged = [];
  for (const rect of rects.sort((a, b) => a.top - b.top || a.left - b.left)) {
    const previous = merged.at(-1);
    if (previous && Math.abs(previous.top - rect.top) < 2 && Math.abs(previous.height - rect.height) < 2 && rect.left <= previous.left + previous.width + rect.height * .35) {
      previous.width = Math.max(previous.left + previous.width, rect.left + rect.width) - previous.left;
    } else merged.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  }
  return merged;
}

export function sourceFontSize(paragraph, pageHeight) {
  const samples = (paragraph.sourceSegments || []).filter((s) => s.rect?.height > 0 && s.text?.trim())
    .map((s) => ({ size: s.rect.height * pageHeight, weight: s.text.trim().length })).sort((a, b) => a.size - b.size);
  const halfway = samples.reduce((sum, sample) => sum + sample.weight, 0) / 2;
  let weight = 0;
  for (const sample of samples) {
    weight += sample.weight;
    if (weight >= halfway) return sample.size;
  }
  return null;
}
