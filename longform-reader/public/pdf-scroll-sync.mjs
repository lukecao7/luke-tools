// Track the same page and progress within that page, even when translations
// are taller than the PDF. Whole-document percentages accumulate page drift.
export function createPdfScrollSync({ original, translation, view, position, onChange, onUserScroll }) {
  const panes = [
    { element: original, selector: ".pdf-page-shell" },
    { element: translation, selector: ".pdf-translation-page" },
  ];
  const signal = new AbortController();
  let active = view === "translation" ? panes[1] : panes[0];
  let current = position || { pageNumber: 1, fraction: 0, edge: "start" };
  let alignment = position?.alignment || null;
  let frame;
  const visible = (pane) => pane.element.clientHeight > 0;
  const maxScroll = (pane) => Math.max(0, pane.element.scrollHeight - pane.element.clientHeight);
  const readingLine = (pane) => Math.min(90, pane.element.clientHeight / 4);

  function pages(pane) {
    const origin = pane.element.getBoundingClientRect().top - pane.element.scrollTop;
    return [...pane.element.querySelectorAll(pane.selector)].map((element) => ({
      pageNumber: Number(element.dataset.pageNumber),
      top: element.getBoundingClientRect().top - origin,
      height: element.getBoundingClientRect().height,
    }));
  }

  function read(pane) {
    const entries = pages(pane);
    if (!entries.length || !visible(pane)) return current;
    const top = pane.element.scrollTop;
    if (top <= 1) return { pageNumber: entries[0].pageNumber, fraction: 0, edge: "start" };
    if (top >= maxScroll(pane) - 1) return { pageNumber: entries.at(-1).pageNumber, fraction: 1, edge: "end" };
    const anchor = top + readingLine(pane);
    const index = entries.findIndex((entry, i) => !entries[i + 1] || entries[i + 1].top > anchor);
    const entry = entries[index];
    const end = entries[index + 1]?.top ?? entry.top + entry.height;
    return { pageNumber: entry.pageNumber, fraction: Math.max(0, Math.min(1, (anchor - entry.top) / Math.max(1, end - entry.top))) };
  }

  function write(pane, target) {
    if (!visible(pane)) return;
    target = project(target, pane);
    const entries = pages(pane);
    const index = entries.findIndex((entry) => entry.pageNumber === target.pageNumber);
    if (index < 0) return;
    const entry = entries[index];
    const end = entries[index + 1]?.top ?? entry.top + entry.height;
    const top = target.edge === "start" ? 0 : target.edge === "end" ? maxScroll(pane)
      : entry.top + target.fraction * (end - entry.top) - readingLine(pane);
    const clamped = Math.max(0, Math.min(maxScroll(pane), top));
    if (Math.abs(pane.element.scrollTop - clamped) < 0.5) return;
    // Round toward the page being entered so subpixel layout cannot leave one
    // pane just before a page boundary while the other has crossed it.
    pane.element.scrollTo({ top: Math.ceil(clamped), behavior: "instant" });
    // Scroll events arrive later. Ignore only the position we actually wrote;
    // a user's next movement in either pane must take control immediately.
    pane.expected = pane.element.scrollTop;
  }

  function publish() {
    onChange({ ...current, alignment }, active.element);
  }

  function restore(target = current) {
    if ("alignment" in target) alignment = target.alignment;
    current = target;
    for (const pane of panes) write(pane, current);
    publish();
  }

  // After focusing corresponding text, retain that pair as an extra landmark
  // within its page. The next wheel movement must not undo the focused pairing.
  function project(target, pane, inverse = false) {
    if (!alignment || pane !== panes[1] || target.edge) return target;
    const translationPage = alignment.translationPageNumber || alignment.pageNumber;
    if (translationPage !== alignment.pageNumber) {
      const a = alignment.pageNumber - 1 + alignment.original;
      const b = translationPage - 1 + alignment.translation;
      const from = inverse ? b : a, to = inverse ? a : b;
      const lower = Math.min(Math.floor(a), Math.floor(b));
      const upper = Math.max(Math.floor(a), Math.floor(b)) + 1;
      const value = target.pageNumber - 1 + target.fraction;
      if (value <= lower || value >= upper) return target;
      const mapped = value <= from ? lower + (value-lower)*(to-lower)/(from-lower)
        : to + (value-from)*(upper-to)/(upper-from);
      return { ...target, pageNumber: Math.floor(mapped)+1, fraction: mapped-Math.floor(mapped) };
    }
    if (target.pageNumber !== alignment.pageNumber) return target;
    const from = inverse ? alignment.translation : alignment.original;
    const to = inverse ? alignment.original : alignment.translation;
    const fraction = target.fraction <= from ? target.fraction * to / from
      : to + (target.fraction - from) * (1 - to) / (1 - from);
    return { ...target, fraction };
  }

  function focus(pageNumber, originalRect, translationRect, translationPageNumber = pageNumber, anchorSide = "original") {
    alignment = null;
    active = anchorSide === "translation" || view === "translation" ? panes[1] : panes[0];
    cancelAnimationFrame(frame);
    // Keep the pane the user clicked stationary; align the other pane.
    const pane = anchorSide === "translation" ? panes[0] : panes[1];
    if (translationRect && originalRect && visible(pane)) {
      const target = Math.max(0, Math.min(maxScroll(pane), pane.element.scrollTop + (anchorSide === "translation" ? originalRect.top - translationRect.top : translationRect.top - originalRect.top)));
      pane.element.scrollTo({ top: target, behavior: "instant" });
      pane.expected = pane.element.scrollTop;
      pane.lastTop = pane.element.scrollTop;
    }
    const left = read(panes[0]), right = read(panes[1]);
    if (view === "compare" && !translationRect) write(panes[1], left);
    if (view === "compare" && !left.edge && !right.edge) {
      alignment = { pageNumber: left.pageNumber, ...(right.pageNumber !== left.pageNumber ? { translationPageNumber: right.pageNumber } : {}), original: Math.max(.0001, Math.min(.9999, left.fraction)), translation: Math.max(.0001, Math.min(.9999, right.fraction)) };
    }
    current = project(read(active), active, true);
    publish();
  }

  for (const pane of panes) {
    pane.lastTop = pane.element.scrollTop;
    pane.element.addEventListener("scroll", () => {
      const top = pane.element.scrollTop;
      if (!visible(pane)) return;
      if (pane.expected !== undefined && Math.abs(top - pane.expected) < 1) {
        pane.expected = undefined;
        pane.lastTop = top;
        return;
      }
      pane.expected = undefined;
      if (Math.abs(top - pane.lastTop) < 0.5) return; // Horizontal movement only.
      onUserScroll?.();
      pane.lastTop = top;
      active = pane;
      current = project(read(pane), pane, true);
      if (view === "compare") write(panes.find((other) => other !== pane), current);
      publish();
    }, { passive: true, signal: signal.signal });
  }

  // Reflow changes translation heights after window resizing or font loading.
  // Keep the last reading anchor instead of reading from shifted coordinates.
  const resize = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => restore());
  });
  for (const pane of panes) {
    resize.observe(pane.element);
    pane.element.querySelectorAll(pane.selector).forEach((element) => resize.observe(element));
  }
  restore();
  return {
    getPosition: () => ({ ...current, alignment }),
    restore,
    focus,
    jump: (pageNumber) => { alignment = null; restore({ pageNumber, fraction: 0 }); },
    destroy() {
      signal.abort();
      resize.disconnect();
      cancelAnimationFrame(frame);
    },
  };
}
