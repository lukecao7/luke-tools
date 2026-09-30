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
        width: 276px; max-width: calc(100vw - 24px); margin: 0; padding: 14px 16px 12px;
        border: 1px solid #71602d; border-top: 3px solid #f6cb66; border-radius: 13px;
        background: #1d201d; color: #fbfaf3; box-shadow: 0 5px 26px #0006;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
        font-size: 12px; line-height: 1.4; cursor: grab; user-select: none; touch-action: none;
        opacity: 1; visibility: visible; pointer-events: auto; color-scheme: dark;
      }
      .panel::backdrop { background: transparent; pointer-events: none; }
      .panel:focus-visible { outline: 2px solid #f6cb66; outline-offset: 3px; }
      .head { display: flex; align-items: center; gap: 7px; color: #e9dda8; }
      .dot { width: 6px; height: 6px; background: #f6cb66; border-radius: 50%; }
      .state { margin-left: auto; color: #b4b9ac; font-size: 10px; }
      .time { display: block; margin: 5px 0 7px; color: #ffdb83; font-size: 31px;
        line-height: 1.1; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: 1px; }
      .details { display: flex; justify-content: space-between; gap: 8px; color: #c0c5b9;
        font-size: 10px; font-variant-numeric: tabular-nums; }
      .note { margin-top: 9px; padding-top: 7px; border-top: 1px solid #ffffff17; color: #a4ac9c; font-size: 10px; }
      .panel[data-level="warm"] { border-top-color: #ffa56a; }
      .panel[data-level="warm"] .time { color: #ffb079; }
      .panel[data-level="hot"] { border-top-color: #ff8074; }
      .panel[data-level="hot"] .time { color: #ff978b; }
      .panel[data-level="hot"] .note { color: #ffb1a9; }
      @media (prefers-reduced-motion: reduce) { * { animation: none; transition: none; } }
    </style>
    <aside class="panel" popover="manual" tabindex="0" aria-label="常驻时长提醒；可拖动，或用方向键移动" title="拖动调整位置，也可以聚焦后用方向键移动">
      <div class="head"><span class="dot"></span><span>今日已刷</span><span class="state">正在连接</span></div>
      <strong class="time" role="timer" aria-live="off">00:00:00</strong>
      <div class="details"><span class="site"></span><span class="session">本次 00:00:00</span></div>
      <div class="note">三个网站累计 · 拖动调整位置</div>
    </aside>`;
  const panel = root.querySelector(".panel");
  const timeEl = root.querySelector(".time");
  const siteEl = root.querySelector(".site");
  const sessionEl = root.querySelector(".session");
  const statusEl = root.querySelector(".state");
  const noteEl = root.querySelector(".note");
  siteEl.textContent = `${name} 00:00:00`;
  let data = null;
  let receivedAt = 0;
  let position = {x: 1, y: 0};
  let positionLoaded = false;
  let sending = false;
  let pending = false;
  let drag = null;
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
    panel.style.left = `${12 + position.x * (maxX - 12)}px`;
    panel.style.top = `${12 + position.y * (maxY - 12)}px`;
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
    if (!data) return;
    const age = performance.now() - receivedAt;
    const live = data.running && document.visibilityState === "visible" && age < 11000 && !failure;
    // Never extrapolate through laptop sleep or across midnight.
    const extra = live && data.date === C.dayKey() ? Math.min(6000, age) : 0;
    const freshDay = data.date === C.dayKey();
    const total = (freshDay ? data.totalMs : 0) + extra;
    timeEl.textContent = C.format(total);
    siteEl.textContent = `${name} ${C.format((freshDay ? data.siteMs : 0) + extra)}`;
    sessionEl.textContent = `本次 ${C.format(data.sessionMs + extra)}`;
    statusEl.textContent = failure ? "请刷新恢复记录" : age >= 11000 ? "连接恢复中" : live ? "正在记录" : "后台不计时";
    panel.dataset.level = total >= 3600000 ? "hot" : total >= 1800000 ? "warm" : "normal";
    noteEl.textContent = total >= 3600000 ? "今天已超过 1 小时，先放下休息一下。"
      : total >= 1800000 ? "今天已超过 30 分钟，记得休息。"
      : "三个网站累计 · 拖动调整位置";
  }
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
    if (event.button !== 0) return;
    event.stopPropagation();
    const r = panel.getBoundingClientRect();
    drag = {x: event.clientX - r.left, y: event.clientY - r.top};
    panel.setPointerCapture(event.pointerId);
    panel.style.cursor = "grabbing";
  });
  panel.addEventListener("pointermove", event => { if (drag) moveTo(event.clientX - drag.x, event.clientY - drag.y); });
  function endDrag() { if (!drag) return; drag = null; panel.style.cursor = "grab"; savePosition(); }
  panel.addEventListener("pointerup", endDrag);
  panel.addEventListener("pointercancel", endDrag);
  panel.addEventListener("lostpointercapture", endDrag);
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
