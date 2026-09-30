(() => {
  if (globalThis.__stayAwareLoaded) return;
  globalThis.__stayAwareLoaded = true;
  const C = AwareCore;
  const site = C.siteForUrl(location.href);
  if (!site) return;
  const name = C.SITES.find(s => s.id === site).label;
  const host = document.createElement("stay-aware-reminder");
  host.setAttribute("aria-label", "浏览时长常驻提醒");
  const root = host.attachShadow({mode: "closed"});
  root.innerHTML = `
    <style>
      :host { all: initial !important; position: fixed !important; inset: 0 auto auto 0 !important;
        width: 0 !important; height: 0 !important; display: block !important;
        opacity: 1 !important; visibility: visible !important; z-index: 2147483647 !important; }
      .panel { all: initial; box-sizing: border-box; position: fixed; inset: auto;
        width: 328px; max-width: calc(100vw - 24px); margin: 0; padding: 0;
        border: 1px solid #ffffff40; border-radius: 18px;
        background: linear-gradient(125deg, #e32940, #d0143a); color: #fff;
        box-shadow: 0 8px 24px #a613302e, 0 2px 6px #90112b1a, inset 0 1px 0 #ffffff26;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
        font-size: 12px; line-height: 1.4; cursor: grab; user-select: none; touch-action: none;
        opacity: 1; visibility: visible; pointer-events: auto; color-scheme: light;
      }
      *, *::before, *::after { box-sizing: border-box; }
      .panel::backdrop { background: transparent; pointer-events: none; }
      .panel:focus-visible { outline: 2px solid #ef7b8e; outline-offset: 3px; }
      .summary { height: 165px; display: flex; flex-direction: column; align-items: center;
        gap: 17px; padding: 20px 28px; white-space: nowrap; }
      .meta { width: 100%; height: 54px; display: flex; align-items: center; gap: 11px; }
      .dot { flex: 0 0 7px; height: 7px; background: #fff; border-radius: 50%; }
      .label { font-size: 17px; color: #fff; }
      .time-switch { all: unset; display: block; height: 54px; line-height: 54px; cursor: pointer; border-radius: 6px; }
      .time-switch:focus-visible { outline: 2px solid #fff0f3; outline-offset: 4px; }
      .time { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 48px; line-height: 54px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: 2px; }
      .grip { width: 11px; height: 17px; margin-left: auto; flex-shrink: 0; color: #ffffffb3; }
      .details { position: absolute; width: 328px; max-width: calc(100vw - 24px); right: -1px; top: calc(100% + 9px); padding: 12px;
        border: 1px solid #f1dbe0; border-radius: 12px; background: #fffcfd; color: #45343b;
        box-shadow: 0 5px 20px #6b1d321c; cursor: default; visibility: hidden; opacity: 0;
        transition: opacity .12s ease; }
      .details::before { content: ""; position: absolute; left: 0; right: 0; height: 10px; bottom: 100%; }
      .panel[data-side="up"] .details { top: auto; bottom: calc(100% + 9px); }
      .panel[data-side="up"] .details::before { bottom: auto; top: 100%; }
      .panel[data-align="left"] .details { right: auto; left: -1px; }
      .panel:is(:hover, :focus-visible) .details, .panel:has(.time-switch:focus-visible) .details { visibility: visible; opacity: 1; }
      .panel[data-dragging="true"] .details { visibility: hidden; opacity: 0; }
      .panel[data-dragging="true"], .panel[data-dragging="true"] .time-switch { cursor: grabbing; }
      .detail-head { display: flex; justify-content: space-between; align-items: center; gap: 6px;
        margin-bottom: 10px; font-size: 10px; color: #81525e; }
      .state { font-size: 9px; color: #81525e; white-space: nowrap; }
      .panel[data-status="running"] .state { color: #b52343; }
      .detail-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; font-size: 11px; }
      .detail-row span:last-child { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px; font-variant-numeric: tabular-nums; color: #8a3449; }
      .note { margin-top: 9px; padding-top: 8px; border-top: 1px solid #f5e6eb; color: #81525e; font-size: 10px; line-height: 1.6; }
      .panel[data-level="warm"] { background: linear-gradient(125deg, #d8203b, #bb1136); }
      .panel[data-level="hot"] { background: linear-gradient(125deg, #be1634, #a80f2b); border-color: #ffb6c2; }
      .panel[data-level="hot"] .note { color: #a80f2b; }
      .panel[data-status="error"] { background: #99505c; }
      @media (max-width: 360px) {
        .summary { padding-inline: 18px; }
        .time { font-size: 44px; letter-spacing: 1.5px; }
      }
      @media (prefers-reduced-motion: reduce) { * { animation: none; transition: none; } }
    </style>
    <aside class="panel" popover="manual" tabindex="0" aria-label="常驻浏览时长；单击数字切换今日累计和本次浏览，悬停查看明细，拖动或用方向键移动">
      <div class="summary">
        <button class="time-switch" type="button" aria-label="显示今日累计，单击切换为本次浏览" title="单击切换今日累计 / 本次浏览"><span class="time" role="timer" aria-live="off">00:00:00</span></button>
        <div class="meta"><span class="dot" aria-hidden="true"></span><span class="label">今日累计</span>
          <svg class="grip" viewBox="0 0 8 12" fill="currentColor" aria-hidden="true"><circle cx="2" cy="2" r="1"/><circle cx="6" cy="2" r="1"/><circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/><circle cx="2" cy="10" r="1"/><circle cx="6" cy="10" r="1"/></svg>
        </div>
      </div>
      <div class="details">
        <div class="detail-head"><span>浏览时长明细</span><span class="state">正在连接</span></div>
        <div class="detail-row"><span>今日累计</span><span class="total">00:00:00</span></div>
        <div class="detail-row"><span>${name}今日</span><span class="site">00:00:00</span></div>
        <div class="detail-row"><span>本次浏览</span><span class="session">00:00:00</span></div>
        <div class="note">单击时间切换 · 拖动调整位置</div>
      </div>
    </aside>`;
  const panel = root.querySelector(".panel");
  const timeEl = root.querySelector(".time");
  const timeButton = root.querySelector(".time-switch");
  const totalEl = root.querySelector(".total");
  const siteEl = root.querySelector(".site");
  const sessionEl = root.querySelector(".session");
  const statusEl = root.querySelector(".state");
  const noteEl = root.querySelector(".note");
  const labelEl = root.querySelector(".label");
  let data = null;
  let receivedAt = 0;
  let position = {x: 1, y: 0};
  let positionLoaded = false;
  let sending = false;
  let pending = false;
  let drag = null;
  let suppressClick = false;
  let displayMode = "today";
  let modeRevision = 0;
  let failure = false;
  let repairQueued = false;

  function viewport() {
    return {width: Math.min(innerWidth, document.documentElement?.clientWidth || innerWidth), height: innerHeight};
  }
  function place() {
    const v = viewport();
    const r = panel.getBoundingClientRect();
    const maxX = Math.max(12, v.width - r.width - 12);
    const maxY = Math.max(12, v.height - r.height - 12);
    const x = 12 + position.x * (maxX - 12);
    const y = 12 + position.y * (maxY - 12);
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    const details = root.querySelector(".details");
    const detailHeight = details.offsetHeight;
    panel.dataset.side = y + r.height + detailHeight + 20 > v.height ? "up" : "down";
    panel.dataset.align = x + r.width - details.offsetWidth < 12 ? "left" : "right";
  }
  function mount(raise = false) {
    if (!document.documentElement) return;
    // Container fullscreen stays interactive; replaced video elements use the top layer.
    const fs = document.fullscreenElement;
    const parent = fs && !/^(VIDEO|IFRAME|CANVAS|IMG)$/.test(fs.tagName) ? fs : document.documentElement;
    if (host.parentNode !== parent) {
      if (panel.matches(":popover-open")) panel.hidePopover();
      parent.appendChild(host);
    }
    host.removeAttribute("hidden");
    if (host.hasAttribute("style")) host.removeAttribute("style");
    if (raise && panel.matches(":popover-open")) panel.hidePopover();
    if (!panel.matches(":popover-open")) {
      try { panel.showPopover(); } catch { /* Retry after fullscreen finishes. */ }
    }
    if (!drag) place();
  }
  function scheduleRepair() {
    if (repairQueued) return;
    repairQueued = true;
    queueMicrotask(() => { repairQueued = false; mount(); });
  }
  panel.addEventListener("toggle", event => { if (event.newState === "closed") scheduleRepair(); });
  new MutationObserver(scheduleRepair).observe(host, {attributes: true, attributeFilter: ["style", "hidden"]});

  function render() {
    mount();
    const modeLabel = displayMode === "session" ? "本次浏览" : "今日累计";
    const nextLabel = displayMode === "session" ? "今日累计" : "本次浏览";
    labelEl.textContent = failure ? "请刷新页面" : modeLabel;
    panel.dataset.mode = displayMode;
    timeButton.setAttribute("aria-label", `显示${modeLabel}，单击切换为${nextLabel}`);
    if (!data) { panel.dataset.status = failure ? "error" : "connecting"; return; }
    const age = performance.now() - receivedAt;
    const live = data.running && document.visibilityState === "visible" && age < 11000 && !failure;
    // Never extrapolate through laptop sleep or across midnight.
    const extra = live && data.date === C.dayKey() ? Math.min(6000, age) : 0;
    const freshDay = data.date === C.dayKey();
    const total = (freshDay ? data.totalMs : 0) + extra;
    timeEl.textContent = C.format(displayMode === "session" ? data.sessionMs + extra : total);
    totalEl.textContent = C.format(total);
    siteEl.textContent = C.format((freshDay ? data.siteMs : 0) + extra);
    sessionEl.textContent = C.format(data.sessionMs + extra);
    statusEl.textContent = failure ? "请刷新恢复记录" : age >= 11000 ? "连接恢复中" : live ? "正在记录" : "后台不计时";
    panel.dataset.status = failure ? "error" : live ? "running" : "background";
    panel.dataset.level = total >= 3600000 ? "hot" : total >= 1800000 ? "warm" : "normal";
    noteEl.textContent = total >= 3600000 ? "今天已超过 1 小时，先放下休息一下。"
      : total >= 1800000 ? "今天已超过 30 分钟，记得休息。"
      : "单击时间切换 · 拖动调整位置";
  }
  function toggleDisplayMode() {
    displayMode = displayMode === "today" ? "session" : "today";
    modeRevision++;
    render();
    // This preference is separate from the ledger; switching never changes either timer.
    try { chrome.storage.local.set({displayMode}).catch(() => {}); } catch { /* A reloaded extension needs a page refresh. */ }
  }
  timeButton.addEventListener("click", toggleDisplayMode);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.displayMode) return;
    modeRevision++;
    displayMode = changes.displayMode.newValue === "session" ? "session" : "today";
    render();
  });
  chrome.storage.local.get("displayMode").then(stored => {
    if (modeRevision) return;
    displayMode = stored.displayMode === "session" ? "session" : "today";
    render();
  }).catch(() => {});
  async function heartbeat() {
    if (sending) { pending = true; return; }
    sending = true;
    try {
      const result = await chrome.runtime.sendMessage({type: "HEARTBEAT", visible: document.visibilityState === "visible"});
      if (!result?.ok) throw new Error(result?.error || "暂时无法记录");
      data = result;
      receivedAt = performance.now();
      failure = false;
      if (!positionLoaded) { position = result.position || position; positionLoaded = true; }
    } catch {
      failure = true;
      statusEl.textContent = "请刷新以恢复记录";
    } finally {
      sending = false;
      render();
      if (pending) { pending = false; void heartbeat(); }
    }
  }
  function moveTo(x, y) {
    const v = viewport();
    const r = panel.getBoundingClientRect();
    const availableX = Math.max(0, v.width - r.width - 24);
    const availableY = Math.max(0, v.height - r.height - 24);
    position = {
      x: availableX ? Math.max(0, Math.min(1, (x - 12) / availableX)) : 0,
      y: availableY ? Math.max(0, Math.min(1, (y - 12) / availableY)) : 0
    };
    place();
  }
  function savePosition() {
    chrome.runtime.sendMessage({type: "POSITION", ...position}).catch(() => {});
  }
  panel.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !event.isPrimary || !event.target.closest(".summary")) return;
    event.stopPropagation();
    const r = panel.getBoundingClientRect();
    suppressClick = false;
    drag = {pointerId: event.pointerId, x: event.clientX - r.left, y: event.clientY - r.top,
      startX: event.clientX, startY: event.clientY, moved: false};
    // Capture on the button itself so a stationary click still reaches its native handler.
    (event.target.closest(".time-switch") || panel).setPointerCapture(event.pointerId);
  });
  panel.addEventListener("pointermove", event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
    drag.moved = true;
    suppressClick = true;
    panel.dataset.dragging = "true";
    moveTo(event.clientX - drag.x, event.clientY - drag.y);
  });
  function endDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = drag.moved;
    suppressClick = moved || event.type !== "pointerup";
    drag = null;
    panel.dataset.dragging = "false";
    if (moved) savePosition();
  }
  panel.addEventListener("pointerup", endDrag);
  panel.addEventListener("pointercancel", endDrag);
  panel.addEventListener("lostpointercapture", endDrag);
  panel.addEventListener("click", event => {
    if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); }
    suppressClick = false;
  }, true);
  panel.addEventListener("click", event => event.stopPropagation());
  panel.addEventListener("keydown", event => {
    const directions = {ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20]};
    if (!directions[event.key]) return;
    event.preventDefault(); event.stopPropagation();
    const [dx, dy] = directions[event.key];
    const r = panel.getBoundingClientRect();
    moveTo(r.left + dx, r.top + dy); savePosition();
  });
  document.addEventListener("fullscreenchange", () => { mount(true); void heartbeat(); });
  document.addEventListener("visibilitychange", () => { render(); void heartbeat(); });
  window.addEventListener("pageshow", () => { mount(); void heartbeat(); });
  window.addEventListener("pagehide", () => {
    chrome.runtime.sendMessage({type: "HEARTBEAT", visible: false}).catch(() => {});
  });
  window.addEventListener("focus", () => { void heartbeat(); });
  window.addEventListener("resize", () => place());
  chrome.runtime.onMessage.addListener(message => { if (message.type === "REFRESH") void heartbeat(); });
  if (!document.documentElement) document.addEventListener("DOMContentLoaded", () => mount(), {once: true});
  mount();
  void heartbeat();
  setInterval(() => { if (document.visibilityState === "visible") void heartbeat(); }, 5000);
  setInterval(() => { if (document.visibilityState === "visible") render(); }, 1000);
})();
