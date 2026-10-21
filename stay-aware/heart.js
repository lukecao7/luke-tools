/* A local brush-painted heart. Only committed viewing time advances the paint. */
(() => {
  const CYCLE_MS = 300000, MILESTONE_MS = 4100, W = 320, H = 270, D = 2, MARGIN = 92;
  const PHASES = {grow: 700, scatter: 1200, return: 3000, empty: 3650};
  const random = n => { const a = Math.sin(n * 127.1 + 311.7) * 43758.5453; return a - Math.floor(a); };
  function create(container) {
    const canvas = document.createElement('canvas');
    canvas.width = W * D; canvas.height = H * D;
    canvas.className = 'heart-canvas'; canvas.setAttribute('aria-hidden', 'true');
    const petals = document.createElement('canvas');
    petals.width = (W + MARGIN * 2) * D; petals.height = (H + MARGIN * 2) * D;
    petals.className = 'heart-flowers'; petals.setAttribute('aria-hidden', 'true');
    Object.assign(petals.style, {position: 'absolute', pointerEvents: 'none',
      left: `${-MARGIN / W * 100}%`, top: `${-MARGIN / H * 100}%`,
      width: `${(W + MARGIN * 2) / W * 100}%`, height: `${(H + MARGIN * 2) / H * 100}%`});
    container.replaceChildren(canvas, petals); container.dataset.renderer = 'paint';
    const ctx = canvas.getContext('2d');
    const fx = petals.getContext('2d');
    const paint = document.createElement('canvas'), outline = document.createElement('canvas');
    paint.width = outline.width = W * D; paint.height = outline.height = H * D;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let ready = false, lastMs = null, progress = 0, shown = 0, from = 0, tweenAt = 0, frame = null, serial = 0;
    let top = 30, bottom = 246, rows = [], falling = [], blossoms = [], celebration = null;
    const image = new Image(); image.crossOrigin = 'anonymous';
    function prepare() {
      // Use the generated alpha and dry-brush texture for both contour and fill.
      const raw = document.createElement('canvas');
      raw.width = image.naturalWidth; raw.height = image.naturalHeight;
      const rc = raw.getContext('2d', {willReadFrequently: true}); rc.drawImage(image, 0, 0);
      const rgba = rc.getImageData(0, 0, raw.width, raw.height).data;
      let l = raw.width, t = raw.height, r = 0, b = 0;
      for (let y = 0; y < raw.height; y++) for (let x = 0; x < raw.width; x++) {
        if (rgba[(y * raw.width + x) * 4 + 3] < 90) continue;
        l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y);
      }
      const scale = Math.min(282 / (r - l + 1), 228 / (b - t + 1));
      const x = (W - (r - l + 1) * scale) / 2, y = 28;
      const pc = paint.getContext('2d', {willReadFrequently: true});
      pc.drawImage(image, (x - l * scale) * D, (y - t * scale) * D, raw.width * scale * D, raw.height * scale * D);
      top = y; bottom = y + (b - t + 1) * scale;
      const {width: w, height: h} = paint, data = pc.getImageData(0, 0, paint.width, paint.height).data;
      const mask = new Uint8Array(w * h), outside = new Uint8Array(w * h);
      const queue = new Int32Array(w * h); let head = 0, tail = 0;
      for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] >= 48;
      const add = i => { if (!mask[i] && !outside[i]) { outside[i] = 1; queue[tail++] = i; } };
      for (let x = 0; x < w; x++) { add(x); add((h - 1) * w + x); }
      for (let y = 0; y < h; y++) { add(y * w); add(y * w + w - 1); }
      while (head < tail) {
        const i = queue[head++], x = i % w, y = Math.floor(i / w);
        if (x) add(i - 1); if (x < w - 1) add(i + 1);
        if (y) add(i - w); if (y < h - 1) add(i + w);
      }
      const oc = outline.getContext('2d'), edge = oc.createImageData(w, h);
      rows = Array.from({length: H}, () => []);
      for (let y = 5; y < h - 5; y++) for (let x = 5; x < w - 5; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        if (x % D === 0 && y % D === 0) rows[Math.floor(y / D)].push(x / D);
        if (![i - 4, i + 4, i - w * 4, i + w * 4, i - w * 3 - 3, i + w * 3 + 3].some(j => outside[j])) continue;
        const k = i * 4;
        edge.data[k] = 179; edge.data[k + 1] = 42; edge.data[k + 2] = 35;
        edge.data[k + 3] = Math.min(165, data[k + 3] * (.44 + random(x * 7 + y) * .22));
      }
      oc.putImageData(edge, 0, 0);
      // Sample the painted silhouette: the blossoms begin inside the red heart.
      for (let y = 38; y < H - 12; y += 18) for (let x = 24; x < W - 18; x += 18) {
        const seed = y * 31 + x, px = x + (random(seed) - .5) * 8, py = y + (random(seed + 1) - .5) * 8;
        if (data[(Math.round(py * D) * w + Math.round(px * D)) * 4 + 3] < 100) continue;
        const dx = px - W / 2, dy = py - (top + bottom) / 2;
        const angle = Math.atan2(dy, dx) + (random(seed + 2) - .5) * .7;
        const distance = 42 + random(seed + 3) * 52;
        blossoms.push({x: px, y: py, dx: Math.cos(angle) * distance,
          dy: Math.sin(angle) * distance - 13, seed, size: 3.7 + random(seed + 4) * 2.6});
      }
      ready = true; container.dataset.asset = 'ready'; schedule();
    }
    function level(p) { return bottom - (bottom - top) * p; }
    function drop(p) {
      if (reducedMotion.matches || falling.length >= 9) return;
      const seed = serial++, y = Math.max(top + 2, Math.min(bottom - 3, level(p) + 4));
      const span = rows[Math.round(y)] || [];
      if (!span.length) return;
      const x = span[Math.floor((.16 + random(seed + 3) * .68) * (span.length - 1))];
      falling.push({x, y, fromX: x + (random(seed + 2) - .5) * 22,
        fromY: Math.max(5, top - 20), seed, start: performance.now(), duration: 800 + random(seed + 4) * 350});
    }
    function fleck(f, now) {
      const t = Math.min(1, (now - f.start) / f.duration), size = 2.5 + random(f.seed + 9) * 3;
      ctx.save();
      ctx.translate(f.fromX + (f.x - f.fromX) * t + Math.sin(t * 5 + f.seed) * 3,
        f.fromY + (f.y - f.fromY) * t * t);
      ctx.rotate(f.seed + t * 3.4); ctx.globalAlpha = Math.min(1, t * 5) * (t > .85 ? (1 - t) / .15 : 1);
      ctx.fillStyle = ['#b81d18', '#d8241c', '#ed3930', '#a7211d'][f.seed % 4];
      ctx.beginPath(); ctx.moveTo(-size, -size * .4); ctx.lineTo(size * .3, -size * .7);
      ctx.lineTo(size, size * .2); ctx.lineTo(-size * .3, size * .62); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#f66d56'; ctx.lineWidth = .55;
      ctx.beginPath(); ctx.moveTo(-size * .5, 0); ctx.lineTo(size * .4, -size * .2); ctx.stroke();
      ctx.restore(); return t < 1;
    }
    const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
    function flower(f, x, y, scale, alpha, rotation) {
      fx.save(); fx.translate(x, y); fx.rotate(rotation); fx.scale(scale, scale); fx.globalAlpha = alpha;
      const colors = ['#bd3028', '#db4737', '#b22322', '#e05b49'];
      for (let k = 0; k < 5; k++) {
        fx.save(); fx.rotate(k * Math.PI * 2 / 5);
        fx.fillStyle = colors[(Math.floor(f.seed) + k) % colors.length];
        fx.beginPath(); fx.ellipse(0, -f.size * .63, f.size * .47, f.size * .77, .15, 0, Math.PI * 2); fx.fill();
        fx.strokeStyle = '#fff1db55'; fx.lineWidth = .45;
        fx.beginPath(); fx.moveTo(0, -f.size * .35); fx.lineTo(-f.size * .1, -f.size * 1.12); fx.stroke();
        fx.restore();
      }
      fx.fillStyle = '#f5c77a'; fx.beginPath(); fx.arc(0, 0, f.size * .22, 0, Math.PI * 2); fx.fill();
      fx.restore();
    }
    function clearFlowers() {
      fx.setTransform(1, 0, 0, 1, 0, 0); fx.clearRect(0, 0, petals.width, petals.height);
      container.dataset.flowers = '0';
    }
    function celebrate(now) {
      const elapsed = Math.max(0, now - celebration.at);
      const phase = elapsed < PHASES.grow ? 'grow' : elapsed < PHASES.scatter ? 'hold'
        : elapsed < PHASES.return ? 'scatter' : elapsed < PHASES.empty ? 'return' : 'empty';
      container.dataset.phase = phase; container.dataset.effectElapsed = String(Math.round(elapsed));
      ctx.drawImage(outline, 0, 0, W, H);
      if (elapsed < PHASES.scatter) {
        ctx.drawImage(paint, 0, 0, W, H); container.dataset.fill = '100'; return;
      }
      const t = Math.min(1, (elapsed - PHASES.scatter) / (PHASES.return - PHASES.scatter));
      const ink = 1 - smooth(t / .32);
      if (ink > 0) { ctx.save(); ctx.globalAlpha = ink; ctx.drawImage(paint, 0, 0, W, H); ctx.restore(); }
      container.dataset.fill = String(Math.round(ink * 100));
      if (reducedMotion.matches || t >= 1) return;
      if (!celebration.bounds) {
        // Flowers may drift outside the heart, but remain inside the viewport.
        const rect = canvas.getBoundingClientRect(), sx = rect.width / W, sy = rect.height / H, inset = 12;
        celebration.bounds = {l: Math.max(-MARGIN + 12, (inset - rect.left) / sx),
          r: Math.min(W + MARGIN - 12, (innerWidth - inset - rect.left) / sx),
          t: Math.max(-MARGIN + 12, (inset - rect.top) / sy),
          b: Math.min(H - 16, (innerHeight - inset - rect.top) / sy)};
      }
      const bounds = celebration.bounds;
      fx.setTransform(D, 0, 0, D, MARGIN * D, MARGIN * D);
      let visible = 0;
      for (const f of blossoms) {
        const travel = 1 - Math.pow(1 - t, 2), radius = f.size * 1.6;
        const x = Math.max(bounds.l + radius, Math.min(bounds.r - radius, f.x + f.dx * travel));
        const y = Math.max(bounds.t + radius, Math.min(bounds.b - radius, f.y + f.dy * travel + t * t * 12));
        const alpha = smooth(t / .18) * (1 - smooth((t - .62) / .38));
        flower(f, x, y, .3 + smooth(t / .3) * .7, alpha, f.seed + t * (random(f.seed) - .5) * 2.5);
        if (alpha > .01) visible++;
      }
      container.dataset.flowers = String(visible);
    }
    function render(now) {
      frame = null;
      if (!ready || document.visibilityState !== 'visible') return;
      ctx.setTransform(D, 0, 0, D, 0, 0); ctx.clearRect(0, 0, W, H); clearFlowers();
      if (celebration) { celebrate(now); if (now - celebration.at <= MILESTONE_MS + 200) schedule(); return; }
      container.dataset.phase = 'idle';
      const t = reducedMotion.matches ? 1 : Math.min(1, (now - tweenAt) / 430);
      shown = from + (progress - from) * (1 - Math.pow(1 - t, 3));
      ctx.drawImage(outline, 0, 0, W, H);
      if (shown > 0) {
        ctx.save(); ctx.beginPath();
        // Keep a broken brush edge at the top of the accumulating paint.
        const y = level(shown);
        ctx.moveTo(0, H); ctx.lineTo(0, y);
        for (let x = 0; x <= W; x += 2) ctx.lineTo(x, y + (shown >= .999 ? -12 : (random(x * 3) - .5) * 6 + Math.sin(x * .08) * 1.5));
        ctx.lineTo(W, H); ctx.closePath(); ctx.clip(); ctx.drawImage(paint, 0, 0, W, H); ctx.restore();
      }
      falling = falling.filter(f => fleck(f, now)); container.dataset.falling = String(falling.length);
      if (t < 1 || falling.length) schedule();
    }
    function schedule() { if (frame === null && document.visibilityState === 'visible') frame = requestAnimationFrame(render); }
    function update(ms, live = false, full = false) {
      ms = Math.max(0, Number(ms) || 0);
      if (full && !celebration) celebration = {at: performance.now(), bounds: null};
      else if (!full && celebration) { celebration = null; clearFlowers(); }
      const p = full ? 1 : (ms % CYCLE_MS) / CYCLE_MS, delta = lastMs === null ? 0 : ms - lastMs;
      from = shown; progress = p; tweenAt = performance.now();
      if (lastMs === null || full || p < shown || !live || reducedMotion.matches) shown = from = p;
      if (ready && live && !full && delta > 0 && delta <= 15000 && p > 0) {
        for (let i = 0; i < Math.min(3, Math.max(1, Math.ceil(delta / 5000))); i++) drop(p);
      }
      if (!live || full || delta < 0) falling = [];
      lastMs = ms; container.dataset.fill = String(Math.round(p * 100)); schedule();
    }
    image.onload = () => { try { prepare(); } catch (error) { container.dataset.asset = 'error'; console.warn('手绘心形加载失败', error); } };
    image.onerror = () => { container.dataset.asset = 'error'; };
    const load = () => {
      if (!image.getAttribute('src') && document.visibilityState === 'visible') image.src = chrome.runtime.getURL('assets/paint-heart.png');
    };
    load();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') { if (frame !== null) cancelAnimationFrame(frame); frame = null; falling = []; }
      else { load(); schedule(); }
    });
    reducedMotion.addEventListener('change', () => { falling = []; schedule(); });
    return {update};
  }
  globalThis.AwareHeart = {CYCLE_MS, MILESTONE_MS, PHASES, create};
})();
