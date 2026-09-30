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
