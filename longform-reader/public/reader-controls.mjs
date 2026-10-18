const TOC_KEY = 'longform.reader.toc.v1';
const tocLimit = viewport => Math.max(180, Math.min(420, viewport - 560));
export function readTocPreferences(storage, viewport = 1200) {
  let saved;
  try { saved = JSON.parse(storage.getItem(TOC_KEY)); } catch { /* Defaults also work without browser storage. */ }
  return { width: Number.isFinite(saved?.width) ? Math.max(180, Math.min(420, saved.width)) : 252,
    collapsed: typeof saved?.collapsed === 'boolean' ? saved.collapsed : viewport < 1000 };
}

export function bindTocControls({ body, sidebar, toggle, close, divider, preferences, storage, onBeforeChange, onCommit }) {
  const save = () => { try { storage.setItem(TOC_KEY, JSON.stringify(preferences)); } catch { /* Keep this session usable. */ } };
  const setWidth = value => {
    const max = tocLimit(body.clientWidth);
    const width = Math.max(180, Math.min(max, value));
    body.style.setProperty('--toc-width', `${width}px`);
    divider.setAttribute('aria-valuemax', String(max));
    divider.setAttribute('aria-valuenow', String(Math.round(width)));
    return width;
  };
  setWidth(preferences.width);
  const collapse = collapsed => {
    onBeforeChange?.();
    preferences.collapsed = collapsed;
    sidebar.hidden = collapsed;
    body.classList.toggle('toc-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? '展开目录' : '收起目录');
    if (collapsed && sidebar.contains(document.activeElement)) toggle.focus();
    setWidth(preferences.width); save(); onCommit?.();
  };
  toggle.addEventListener('click', () => collapse(!preferences.collapsed));
  close.addEventListener('click', () => collapse(true));
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); onBeforeChange?.();
    divider.setPointerCapture(event.pointerId); body.classList.add('resizing-toc');
    const move = event => { preferences.width = setWidth(event.clientX - body.getBoundingClientRect().left); };
    const end = () => {
      body.classList.remove('resizing-toc'); divider.removeEventListener('pointermove', move);
      save(); onCommit?.();
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('lostpointercapture', end, { once: true });
  });
  divider.addEventListener('dblclick', () => {
    onBeforeChange?.(); preferences.width = setWidth(252); save(); onCommit?.();
  });
  divider.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault(); onBeforeChange?.();
    preferences.width = setWidth(event.key === 'Home' ? 252 : preferences.width + (event.key === 'ArrowLeft' ? -20 : 20));
    save(); onCommit?.();
  });
}

export function bindPaneDivider({ area, divider, ratio = .5, onChange, onCommit }) {
  const set = value => {
    ratio = Math.max(.25, Math.min(.75, value));
    area.style.setProperty('--source-share', `${ratio * 100}%`);
    divider.style.left = `${ratio * 100}%`;
    divider.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    onChange?.(ratio);
  };
  set(ratio);
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); divider.setPointerCapture(event.pointerId);
    area.classList.add('resizing-panes');
    const move = event => {
      const box = area.getBoundingClientRect();
      set((event.clientX - box.left) / box.width);
    };
    const end = () => {
      area.classList.remove('resizing-panes');
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('lostpointercapture', end);
      onCommit?.(ratio);
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('lostpointercapture', end, { once:true });
  });
  divider.addEventListener('dblclick', () => { set(.5); onCommit?.(ratio); });
  divider.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home'].includes(event.key)) return;
    event.preventDefault();
    set(event.key === 'Home' ? .5 : ratio + (event.key === 'ArrowLeft' ? -.025 : .025));
    onCommit?.(ratio);
  });
}

// One translucent, softly blurred sheet, with clear windows over the evidence.
// Using a mask (instead of blurring whole paragraphs) keeps saved words crisp.
export function setFocusVeil(container, rects, enabled) {
  let veil = container.querySelector(':scope > .reading-focus-veil');
  if (!enabled) { veil?.remove(); return; }
  if (!veil) { veil = document.createElement('div'); veil.className = 'reading-focus-veil'; veil.setAttribute('aria-hidden','true'); container.append(veil); }
  const box = container.getBoundingClientRect();
  const holes = rects.filter(r=>r.width>0 && r.height>0).map(r => `<rect x="${Math.max(0,r.left-box.left-2)}" y="${Math.max(0,r.top-box.top-2)}" width="${r.width+4}" height="${r.height+4}" rx="2" fill="black"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="0 0 ${box.width} ${box.height}"><defs><mask id="m"><rect width="100%" height="100%" fill="white"/>${holes}</mask></defs><rect width="100%" height="100%" fill="white" mask="url(#m)"/></svg>`;
  veil.style.maskImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function closeDialogOnOutside(dialog, contentSelector) {
  dialog.addEventListener('click', event => { if (!event.target.closest(contentSelector)) dialog.close(); });
  dialog.addEventListener('close', () => dialog.remove(), { once:true });
}
