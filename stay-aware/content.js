(() => {
  if (globalThis.__stayAwareLoaded) return;
  globalThis.__stayAwareLoaded = true;
  const C = AwareCore;
  const site = C.siteForUrl(location.href);
  if (!site) return;
  const name = C.SITES.find(s => s.id === site).label;
  const host = document.createElement("stay-aware-reminder");
  host.setAttribute("aria-label", "浏览时长常驻提醒");
  host.dataset.awareVersion = chrome.runtime.getManifest().version;
  const root = host.attachShadow({mode: "closed"});
  const milestonePoint = phase => AwareHeart.PHASES[phase] / AwareHeart.MILESTONE_MS * 100;
  root.innerHTML = `
    <style>
      :host { all: initial !important; position: fixed !important; inset: 0 auto auto 0 !important;
        width: 0 !important; height: 0 !important; display: block !important;
        opacity: 1 !important; visibility: visible !important; z-index: 2147483647 !important; }
      .panel { all: initial; box-sizing: border-box; position: fixed; inset: auto;
        width: calc(320px * var(--aware-scale, 1)); max-width: calc(100vw - 24px); margin: 0; padding: 0;
        border: 0; background: transparent; color: #8c1f40;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
        font-size: calc(12px * var(--aware-scale, 1)); line-height: 1.4; cursor: grab; user-select: none; touch-action: none;
        opacity: 1; visibility: visible; pointer-events: none; color-scheme: light;
      }
      *, *::before, *::after { box-sizing: border-box; }
      .panel::backdrop { background: transparent; pointer-events: none; }
      .panel:focus-visible { outline: none; }
      .panel:focus-visible .heart-art { filter: drop-shadow(0 0 5px #f3567a); }
      .summary { position: relative; height: calc(330px * var(--aware-scale, 1)); white-space: nowrap; }
      .heart-art { position: absolute; inset: 0 0 auto; height: calc(270px * var(--aware-scale, 1)); pointer-events: none; }
      .heart-canvas { display: block; width: 100%; height: 100%; pointer-events: auto; }
      .heart-unavailable { display: block; text-align: center; font-size: calc(260px * var(--aware-scale, 1)); line-height: 1; color: #d33a66; }
      .time-switch, .stats-toggle, .details { pointer-events: auto; }
      .time-switch { all: unset; pointer-events: auto; position: absolute; top: calc(265px * var(--aware-scale, 1)); left: 50%; transform: translateX(-50%);
        display: block; padding: calc(3px * var(--aware-scale, 1)) calc(10px * var(--aware-scale, 1));
        border-radius: calc(6px * var(--aware-scale, 1)); background: #fffdf8e8;
        border: 1px solid #d8ccc355; box-shadow: 0 2px 8px #562b4008; cursor: pointer; }
      .time-switch:focus-visible { outline: 2px solid #e05173; outline-offset: 3px; }
      .time { font-size: calc(26px * var(--aware-scale, 1)); line-height: calc(34px * var(--aware-scale, 1));
        font-weight: 500; font-variant-numeric: tabular-nums; letter-spacing: calc(.6px * var(--aware-scale, 1)); color: #654038; }
      .stats-toggle { all: unset; pointer-events: auto; position: absolute; left: calc(50% + 91px * var(--aware-scale, 1)); top: calc(273px * var(--aware-scale, 1));
        display: grid; place-items: center; width: calc(27px * var(--aware-scale, 1)); height: calc(27px * var(--aware-scale, 1));
        border: 1px solid #ffffffcc; border-radius: 50%; background: #ffffffb3; backdrop-filter: blur(12px);
        box-shadow: 0 3px 12px #562b4010; color: #9a6177; cursor: pointer; }
      .stats-toggle svg { width: 13px; height: 13px; }
      .stats-toggle:is(:hover, [aria-expanded="true"]) { background: #fff; border-color: #e76d8a; }
      .stats-toggle:focus-visible { outline: 2px solid #e05173; outline-offset: 3px; }
      .details { position: absolute; width: calc(320px * var(--aware-scale, 1)); max-width: calc(100vw - 24px); right: calc(-1px * var(--aware-scale, 1)); top: calc(100% + calc(9px * var(--aware-scale, 1))); padding: calc(12px * var(--aware-scale, 1));
        border: calc(1px * var(--aware-scale, 1)) solid #f1dbe0; border-radius: calc(12px * var(--aware-scale, 1)); background: #fffcfd; color: #45343b;
        box-shadow: 0 calc(5px * var(--aware-scale, 1)) calc(20px * var(--aware-scale, 1)) #6b1d321c; cursor: default; visibility: hidden; opacity: 0;
        transition: opacity .12s ease; }
      .details::before { content: ""; position: absolute; left: 0; right: 0; height: calc(10px * var(--aware-scale, 1)); bottom: 100%; }
      .panel[data-side="up"] .details { top: auto; bottom: calc(100% + calc(9px * var(--aware-scale, 1))); }
      .panel[data-side="up"] .details::before { bottom: auto; top: 100%; }
      .panel[data-align="left"] .details { right: auto; left: calc(-1px * var(--aware-scale, 1)); }
      .panel:is(:hover, :focus-visible) .details, .panel:has(.time-switch:focus-visible) .details { visibility: visible; opacity: 1; }
      .panel[data-dragging="true"] .details { visibility: hidden; opacity: 0; }
      .panel[data-statistics="true"] .details { visibility: hidden; opacity: 0; }
      .panel[data-dragging="true"], .panel[data-dragging="true"] .time-switch { cursor: grabbing; }
      .detail-head { display: flex; justify-content: space-between; align-items: center; gap: calc(6px * var(--aware-scale, 1));
        margin-bottom: calc(10px * var(--aware-scale, 1)); font-size: calc(10px * var(--aware-scale, 1)); color: #81525e; }
      .state { font-size: calc(9px * var(--aware-scale, 1)); color: #81525e; white-space: nowrap; }
      .panel[data-status="running"] .state { color: #b52343; }
      .detail-row { display: flex; justify-content: space-between; align-items: center; padding: calc(3px * var(--aware-scale, 1)) 0; font-size: calc(11px * var(--aware-scale, 1)); }
      .detail-row span:last-child { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: calc(12px * var(--aware-scale, 1)); font-variant-numeric: tabular-nums; color: #8a3449; }
      .note { margin-top: calc(9px * var(--aware-scale, 1)); padding-top: calc(8px * var(--aware-scale, 1)); border-top: calc(1px * var(--aware-scale, 1)) solid #f5e6eb; color: #81525e; font-size: calc(10px * var(--aware-scale, 1)); line-height: 1.6; }
      .panel[data-level="hot"] .note { color: #a80f2b; }
      .panel[data-status="error"] .heart-art { filter: grayscale(.8); opacity: .7; }
      .panel[data-milestone="true"] { animation: aware-milestone var(--milestone-duration, ${AwareHeart.MILESTONE_MS}ms) ease both; }
      .panel[data-milestone="true"] .details { visibility: hidden; opacity: 0; }
      @keyframes aware-milestone {
        0% { transform: scale(1); animation-timing-function: cubic-bezier(.22, 1, .36, 1); }
        ${milestonePoint("grow")}%, ${milestonePoint("return")}% { transform: scale(var(--milestone-scale, 2)); }
        ${milestonePoint("empty")}%, 100% { transform: scale(1); }
      }
      @keyframes aware-milestone-still {
        0%, 100% { filter: drop-shadow(0 0 0 #e72c59); }
        ${milestonePoint("grow")}%, ${milestonePoint("scatter")}% { filter: drop-shadow(0 0 7px #e72c5966); }
        ${milestonePoint("return")}% { filter: drop-shadow(0 0 0 #e72c59); }
      }
      .stats-panel { all: initial; box-sizing: border-box; position: fixed; inset: auto; margin: 0; padding: 0;
        border: 1px solid #e8e5ed; border-radius: 16px; background: #fff; color: #353443;
        box-shadow: 0 12px 40px #251b3824; overflow: hidden; display: none; }
      .stats-panel:popover-open { display: flex; flex-direction: column; }
      .stats-panel::backdrop { background: transparent; pointer-events: none; }
      .stats-heading { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding: calc(13px * var(--stats-scale, 1)) calc(20px * var(--stats-scale, 1)); border-bottom: 1px solid #f0edf5;
        font: 600 calc(15px * var(--stats-scale, 1))/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }
      .stats-close { all: unset; flex-shrink: 0; padding: 4px 9px; border-radius: 6px; color: #7d7788; font-size: calc(12px * var(--stats-scale, 1)); font-weight: 400; cursor: pointer; }
      .stats-close:hover { background: #f5f3fa; }
      .stats-close:focus-visible { outline: 2px solid #8d81ca; outline-offset: 2px; }
      .stats-content { min-height: 0; overflow: auto; overscroll-behavior: contain; }
      @media (prefers-reduced-motion: reduce) {
        * { animation: none; transition: none; }
        .panel[data-milestone="true"] { animation: aware-milestone-still var(--milestone-duration, ${AwareHeart.MILESTONE_MS}ms) ease both; }
      }
    </style>
    <aside class="panel" popover="manual" tabindex="0" aria-label="常驻浏览时长；单击数字切换今日累计和本次浏览，悬停查看明细，拖动或用方向键移动">
      <div class="summary">
        <div class="heart-art"></div>
        <button class="time-switch" type="button" aria-label="显示今日累计，单击切换为本次浏览" title="单击切换今日累计 / 本次浏览；每天早上 6 点开始新一天的统计"><span class="time" role="timer" aria-live="off">00:00:00</span></button>
        <button class="stats-toggle" type="button" aria-expanded="false" aria-controls="aware-statistics" aria-label="时长分布" title="展开各网站的小时分布"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 12V8M8 12V3M13 12V6"/></svg></button>
      </div>
      <div class="details">
        <div class="detail-head"><span>浏览时长明细 · 每日 6:00 起算</span><span class="state">正在连接</span></div>
        <div class="detail-row"><span>今日累计</span><span class="total">00:00:00</span></div>
        <div class="detail-row"><span>${name}今日</span><span class="site">00:00:00</span></div>
        <div class="detail-row"><span>本次浏览</span><span class="session">00:00:00</span></div>
        <div class="note">单击时间切换 · 拖动调整位置</div>
      </div>
    </aside>
    <section class="stats-panel" id="aware-statistics" popover="manual" aria-label="浏览时长分布">
      <div class="stats-heading"><span>时长分布</span><button class="stats-close" type="button" aria-label="收起时长分布">收起</button></div>
      <div class="stats-content"></div>
    </section>`;
  const panel = root.querySelector(".panel");
  const timeEl = root.querySelector(".time");
  const timeButton = root.querySelector(".time-switch");
  const totalEl = root.querySelector(".total");
  const siteEl = root.querySelector(".site");
  const sessionEl = root.querySelector(".session");
  const statusEl = root.querySelector(".state");
  const noteEl = root.querySelector(".note");
  const heart = AwareHeart.create(root.querySelector(".heart-art"));
  const statsButton = root.querySelector(".stats-toggle");
  const statsPanel = root.querySelector(".stats-panel");
  const statistics = AwareStats.create(root.querySelector(".stats-content"), {showBrand: false});
  let statisticsOpen = false;
  let data = null;
  let receivedAt = 0;
  let position = {x: 1, y: 0};
  let positionLoaded = false;
  let sending = false;
  const pendingHeartbeats = [];
  let playback = "browsing";
  let lastInteractionAt = Date.now();
  let lastInteractionSentAt = -Infinity;
  let interactionHeartbeatTimer;
  let idleTimer;
  let drag = null;
  let suppressClick = false;
  let displayMode = "today";
  let modeRevision = 0;
  let failure = false;
  let repairQueued = false;
  let appliedScale = 0;
  let milestoneReading = null;
  let milestoneTimer;

  function stopMilestone() {
    clearTimeout(milestoneTimer);
    delete panel.dataset.milestone;
    if (data) paintHeart(displayedDuration(), false);
  }
  function remindAtMilestone() {
    const key = displayMode === "session" ? `session:${site}` : `today:${data.date}`;
    const ms = displayMode === "session" ? data.sessionMs : data.totalMs;
    const previous = milestoneReading;
    const visible = document.visibilityState === "visible";
    milestoneReading = {key, ms, at: data.at, visible};
    // A fresh page, mode change or return from the background establishes a
    // baseline. Only crossing a new five-minute boundary can animate the card.
    if (!visible || !previous?.visible || previous.key !== key || ms < previous.ms
      || data.at - previous.at > C.MAX_GAP || drag
      || Math.floor(ms / 300000) <= Math.floor(previous.ms / 300000)) return;
    stopMilestone();
    const v = viewport();
    const scale = Math.max(1, Math.min(2, (v.width - 24) / panel.offsetWidth, (v.height - 24) / panel.offsetHeight));
    panel.style.setProperty("--milestone-scale", String(scale));
    panel.style.setProperty("--milestone-duration", `${AwareHeart.MILESTONE_MS}ms`);
    panel.style.transformOrigin = `${position.x * 100}% ${position.y * 100}%`;
    panel.dataset.milestone = "true";
    milestoneTimer = setTimeout(stopMilestone, AwareHeart.MILESTONE_MS + 150);
  }
  panel.addEventListener("animationend", event => { if (event.target === panel) stopMilestone(); });

  function viewport() {
    return {width: Math.min(innerWidth, document.documentElement?.clientWidth || innerWidth), height: innerHeight};
  }
  function updateSize(v) {
    // Screen dimensions use logical pixels: Retina density must not double the
    // card. Keep the laptop size, grow on larger displays, then fit the window.
    const screenWidth = screen.width || 1280;
    const screenHeight = screen.height || 800;
    const displayScale = .775 * Math.max(1, Math.min(screenWidth / 1280, screenHeight / 800));
    const desiredScale = Math.max(0.1, Math.min(displayScale, (v.width - 24) / 320, (v.height - 24) / 330));
    const statsScale = Math.min(1.15, Math.max(1, desiredScale));
    const scale = Math.min(desiredScale, 600 * statsScale / 320);
    if (Math.abs(scale - appliedScale) < 0.0001) return;
    panel.style.setProperty("--aware-scale", String(scale));
    appliedScale = scale;
  }
  function place() {
    const v = viewport();
    updateSize(v);
    // Animation transforms must not change the saved position or chart width.
    const r = {width: panel.offsetWidth, height: panel.offsetHeight};
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
    placeStatistics(v, r, x, y);
  }
  function placeStatistics(v, r, x, y) {
    if (!statisticsOpen) return;
    const gap = 10;
    const above = Math.max(0, y - 12 - gap);
    const below = Math.max(0, v.height - y - r.height - 12 - gap);
    const up = above > below;
    // Statistics are reading content: keep their type comfortable even when
    // the reminder deliberately grows on a projector or a large display.
    const statsScale = Math.min(1.15, Math.max(1, appliedScale));
    const width = r.width;
    const height = Math.min(660 * statsScale, up ? above : below);
    const left = x;
    statsPanel.style.setProperty("--stats-scale", String(statsScale));
    statsPanel.style.width = `${width}px`;
    statsPanel.style.maxHeight = `${height}px`;
    statsPanel.style.left = `${left}px`;
    // Measure after changing the width; the viewer can shrink to its content.
    const top = up ? y - gap - statsPanel.getBoundingClientRect().height : y + r.height + gap;
    statsPanel.style.top = `${top}px`;
  }
  function mount(raise = false) {
    if (!document.documentElement) return;
    // Container fullscreen stays interactive; replaced video elements use the top layer.
    const fs = document.fullscreenElement;
    const parent = fs && !/^(VIDEO|IFRAME|CANVAS|IMG)$/.test(fs.tagName) ? fs : document.documentElement;
    if (host.parentNode !== parent) {
      if (panel.matches(":popover-open")) panel.hidePopover();
      if (statsPanel.matches(":popover-open")) statsPanel.hidePopover();
      parent.appendChild(host);
    }
    host.removeAttribute("hidden");
    if (host.hasAttribute("style")) host.removeAttribute("style");
    if (raise && panel.matches(":popover-open")) panel.hidePopover();
    if (raise && statsPanel.matches(":popover-open")) statsPanel.hidePopover();
    if (!panel.matches(":popover-open")) {
      try { panel.showPopover(); } catch { /* Retry after fullscreen finishes. */ }
    }
    if (statisticsOpen && !statsPanel.matches(":popover-open")) {
      try { statsPanel.showPopover(); } catch { /* Fullscreen restoration retries on the next render. */ }
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

  function videoPlayback() {
    // Main players and visible feed previews both count while playing.
    // Hidden/offscreen players cannot keep an unattended page running.
    const videos = [...document.querySelectorAll("video, bwp-video")].filter(video => {
      const r = video.getBoundingClientRect();
      const style = getComputedStyle(video);
      return typeof video.paused === "boolean" && r.width > 0 && r.height > 0
        && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
        && style.display !== "none" && style.visibility !== "hidden";
    });
    if (!videos.length) return "browsing";
    if (videos.some(video => !video.paused && !video.ended)) return "playing";
    return videos.every(video => video.ended) ? "ended" : "paused";
  }
  function updatePlayback() {
    const next = videoPlayback();
    if (next === playback) return;
    playback = next;
    render();
    void heartbeat();
  }
  function scheduleIdleCheck() {
    clearTimeout(idleTimer);
    const remaining = lastInteractionAt + C.INTERACTION_TIMEOUT - Date.now();
    if (remaining > 0 && document.visibilityState === "visible") {
      idleTimer = setTimeout(() => { render(); void heartbeat(); }, remaining);
    }
  }
  function recordInteraction(event) {
    if ((event && !event.isTrusted) || document.visibilityState !== "visible") return;
    const wasIdle = Date.now() >= lastInteractionAt + C.INTERACTION_TIMEOUT;
    lastInteractionAt = Date.now();
    scheduleIdleCheck();
    const sinceSent = performance.now() - lastInteractionSentAt;
    // Send the first/resuming interaction immediately and throttle continuous
    // movement to one write per second, keeping the final event timestamp.
    if (wasIdle || sinceSent >= 1000) {
      clearTimeout(interactionHeartbeatTimer);
      interactionHeartbeatTimer = undefined;
      lastInteractionSentAt = performance.now();
      void heartbeat();
    } else if (!interactionHeartbeatTimer) {
      interactionHeartbeatTimer = setTimeout(() => {
        interactionHeartbeatTimer = undefined;
        lastInteractionSentAt = performance.now();
        void heartbeat();
      }, 1000 - sinceSent);
    }
    if (wasIdle) render();
  }
  // Scroll events also fire for script-driven movement. The input events
  // below cover wheel/touch/keyboard/scrollbar use without counting auto-scroll.
  for (const event of ["pointermove", "pointerdown", "click", "keydown", "wheel", "touchmove"]) {
    document.addEventListener(event, recordInteraction, {capture: true, passive: true});
  }
  for (const event of ["play", "playing", "pause", "ended", "emptied", "loadedmetadata"]) {
    document.addEventListener(event, updatePlayback, true);
  }
  let playbackCheckQueued = false;
  new MutationObserver(() => {
    if (playbackCheckQueued) return;
    playbackCheckQueued = true;
    queueMicrotask(() => { playbackCheckQueued = false; updatePlayback(); });
  }).observe(document, {childList: true, subtree: true});

  function displayedDuration() {
    if (!data) return 0;
    return displayMode === "session" ? data.sessionMs : data.date === C.dayKey() ? data.totalMs : 0;
  }
  function paintHeart(ms, live) {
    const full = panel.dataset.milestone === "true";
    heart.update(ms, live, full);
  }
  function render() {
    if (statisticsOpen && data) statistics.update(data);
    mount();
    const modeLabel = displayMode === "session" ? "本次浏览" : "今日累计";
    const nextLabel = displayMode === "session" ? "今日累计" : "本次浏览";
    panel.dataset.mode = displayMode;
    timeButton.setAttribute("aria-label", failure ? "请刷新页面以恢复记录" : `显示${modeLabel}，单击切换为${nextLabel}`);
    timeButton.title = `当前显示${modeLabel}；单击切换为${nextLabel}；每天早上 6 点开始新一天的统计`;
    if (!data) { panel.dataset.status = failure ? "error" : "connecting"; return; }
    const age = performance.now() - receivedAt;
    const countUntil = C.recordingUntil(playback, lastInteractionAt);
    const idle = countUntil !== null && Date.now() >= countUntil;
    const live = data.running && document.visibilityState === "visible" && age < 3000 && !failure && !idle;
    // Display committed intervals only. Local guesses can advance six seconds
    // beyond the ledger and then roll back when a stopped snapshot arrives.
    const freshDay = data.date === C.dayKey();
    const total = freshDay ? data.totalMs : 0;
    const duration = displayedDuration();
    timeEl.textContent = failure ? "请刷新页面" : C.format(duration);
    paintHeart(duration, live);
    totalEl.textContent = C.format(total);
    siteEl.textContent = C.format(freshDay ? data.siteMs : 0);
    sessionEl.textContent = C.format(data.sessionMs);
    statusEl.textContent = failure ? "请刷新恢复记录" : age >= 3000 ? "连接恢复中"
      : idle ? "5 秒未操作 · 不计时"
      : live ? "正在记录" : "后台不计时";
    panel.dataset.status = failure ? "error" : live ? "running" : idle ? "paused" : "background";
    panel.dataset.level = total >= 3600000 ? "hot" : total >= 1800000 ? "warm" : "normal";
    noteEl.textContent = total >= 3600000 ? "今天已超过 1 小时，先放下休息一下。"
      : total >= 1800000 ? "今天已超过 30 分钟，记得休息。"
      : "单击时间切换 · 拖动调整位置";
  }
  function toggleDisplayMode() {
    displayMode = displayMode === "today" ? "session" : "today";
    milestoneReading = null;
    stopMilestone();
    modeRevision++;
    render();
    // This preference is separate from the ledger; switching never changes either timer.
    try { chrome.storage.local.set({displayMode}).catch(() => {}); } catch { /* A reloaded extension needs a page refresh. */ }
  }
  timeButton.addEventListener("click", toggleDisplayMode);
  function toggleStatistics(open = !statisticsOpen) {
    statisticsOpen = open;
    panel.dataset.statistics = String(open);
    statsButton.setAttribute("aria-expanded", String(open));
    if (open) {
      if (data) statistics.update(data);
      mount();
      void heartbeat();
    } else {
      if (statsPanel.matches(":popover-open")) statsPanel.hidePopover();
      statsButton.focus();
    }
  }
  statsButton.addEventListener("click", () => toggleStatistics());
  root.querySelector(".stats-close").addEventListener("click", () => toggleStatistics(false));
  statsPanel.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); toggleStatistics(false); }
  });
  statsPanel.addEventListener("click", event => event.stopPropagation());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.displayMode) return;
    modeRevision++;
    displayMode = changes.displayMode.newValue === "session" ? "session" : "today";
    milestoneReading = null;
    stopMilestone();
    render();
  });
  chrome.storage.local.get("displayMode").then(stored => {
    if (modeRevision) return;
    displayMode = stored.displayMode === "session" ? "session" : "today";
    milestoneReading = null;
    render();
  }).catch(() => {});
  async function heartbeat() {
    // Inspect the current DOM for every sample, including an autoplay player
    // that was inserted after page load or did not emit a captured play event.
    playback = videoPlayback();
    host.dataset.playback = playback;
    // Preserve every playback transition, even while an earlier request is in
    // flight. A quick pause/resume must not become one continuous interval.
    const message = {type: "HEARTBEAT", visible: document.visibilityState === "visible", playback,
      lastInteractionAt, observedAt: Date.now()};
    if (sending) { pendingHeartbeats.push(message); return; }
    sending = true;
    try {
      let next = message;
      while (next) {
        const result = await chrome.runtime.sendMessage(next);
        if (!result?.ok) throw new Error(result?.error || "暂时无法记录");
        data = result;
        host.dataset.recording = String(result.running);
        host.dataset.recordingReason = result.reason || "unknown";
        host.dataset.workerVersion = result.version || "unknown";
        receivedAt = performance.now();
        failure = false;
        if (!positionLoaded) { position = result.position || position; positionLoaded = true; }
        remindAtMilestone();
        next = pendingHeartbeats.shift();
      }
    } catch {
      pendingHeartbeats.length = 0;
      failure = true;
      statusEl.textContent = "请刷新以恢复记录";
    } finally {
      sending = false;
      render();
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
    if (event.target.closest(".stats-toggle")) return;
    if (event.button !== 0 || !event.isPrimary || !event.target.closest(".summary")) return;
    event.stopPropagation();
    stopMilestone();
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
    stopMilestone();
    const [dx, dy] = directions[event.key];
    const r = panel.getBoundingClientRect();
    moveTo(r.left + dx, r.top + dy); savePosition();
  });
  document.addEventListener("fullscreenchange", () => { stopMilestone(); mount(true); void heartbeat(); });
  document.addEventListener("visibilitychange", () => {
    milestoneReading = null;
    stopMilestone();
    if (document.visibilityState === "visible") recordInteraction();
    else { clearTimeout(idleTimer); clearTimeout(interactionHeartbeatTimer); interactionHeartbeatTimer = undefined; }
    render(); void heartbeat();
  });
  window.addEventListener("pageshow", () => { recordInteraction(); mount(); void heartbeat(); });
  window.addEventListener("pagehide", () => {
    chrome.runtime.sendMessage({type: "HEARTBEAT", visible: false, playback, lastInteractionAt, observedAt: Date.now()}).catch(() => {});
  });
  window.addEventListener("focus", () => { recordInteraction(); });
  window.addEventListener("resize", () => { stopMilestone(); place(); });
  chrome.runtime.onMessage.addListener(message => { if (message.type === "REFRESH") void heartbeat(); });
  if (!document.documentElement) document.addEventListener("DOMContentLoaded", () => mount(), {once: true});
  mount();
  playback = videoPlayback();
  scheduleIdleCheck();
  void heartbeat();
  setInterval(() => { if (document.visibilityState === "visible") { void heartbeat(); render(); } }, 1000);
})();
