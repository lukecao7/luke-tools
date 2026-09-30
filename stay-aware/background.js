importScripts("core.js");
const C = AwareCore;
let state;
let queue = Promise.resolve();

async function loadState() {
  if (state) return;
  const stored = await chrome.storage.local.get("ledger");
  let {browserEpoch} = await chrome.storage.session.get("browserEpoch");
  if (!browserEpoch) {
    browserEpoch = crypto.randomUUID();
    await chrome.storage.session.set({browserEpoch});
  }
  state = stored.ledger?.version === 1 ? stored.ledger : C.freshState(browserEpoch);
  if (state.epoch !== browserEpoch) {
    state.epoch = browserEpoch;
    state.active = null;
    state.sessions = {};
  }
}
function serialized(task) {
  const result = queue.then(async () => { await loadState(); return task(); });
  queue = result.catch(error => console.error("时长记录失败", error));
  return result;
}
async function save() {
  const dates = Object.keys(state.days).sort();
  for (const date of dates.slice(0, Math.max(0, dates.length - 90))) delete state.days[date];
  // Ledger and cursor are one write, so a worker restart cannot replay an interval.
  await chrome.storage.local.set({ledger: state});
}
function snapshot(now, tabId, site) {
  const date = C.dayKey(now);
  const row = state.days[date] || {};
  return {
    ok: true, date, at: now, site, today: row, totalMs: C.total(row),
    siteMs: row[site] || 0,
    sessionMs: state.sessions[tabId]?.site === site ? state.sessions[tabId].ms : 0,
    running: state.active?.tabId === tabId && state.active?.site === site,
    position: state.position,
    history: Object.entries(state.days).sort(([a], [b]) => b.localeCompare(a)).slice(0, 7)
      .map(([date, sites]) => ({date, ms: C.total(sites)}))
  };
}
function ping(tabId) {
  if (Number.isInteger(tabId)) chrome.tabs.sendMessage(tabId, {type: "REFRESH"}).catch(() => {});
}
async function pingActive(windowId) {
  const tabs = await chrome.tabs.query(windowId >= 0 ? {active: true, windowId} : {active: true, lastFocusedWindow: true});
  if (tabs[0]) ping(tabs[0].id);
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  const at = Date.now();
  serialized(async () => {
    if (message.type === "DASHBOARD" && sender.url === chrome.runtime.getURL("popup.html")) {
      C.advance(state, at);
      await save();
      return snapshot(at, null, null);
    }
    if (!sender.tab || sender.frameId !== 0) return {ok: false};
    const site = C.siteForUrl(sender.url);
    if (!site) return {ok: false};
    if (message.type === "POSITION") {
      if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return {ok: false};
      state.position = {x: Math.max(0, Math.min(1, message.x)), y: Math.max(0, Math.min(1, message.y))};
      await save();
      return {ok: true};
    }
    if (message.type !== "HEARTBEAT") return {ok: false};
    const tab = await chrome.tabs.get(sender.tab.id).catch(() => null);
    const win = tab ? await chrome.windows.get(tab.windowId).catch(() => null) : null;
    const lockState = await chrome.idle.queryState(60);
    const running = Boolean(message.visible && tab?.active && win?.focused && lockState !== "locked" && C.siteForUrl(tab.url) === site);
    C.advance(state, at);
    if (running) {
      if (state.sessions[tab.id]?.site !== site) state.sessions[tab.id] = {site, ms: 0};
      state.active = {tabId: tab.id, documentId: sender.documentId, site, at, lastSeen: at};
    } else if (state.active?.tabId === sender.tab.id && state.active?.documentId === sender.documentId) {
      state.active = null;
    }
    await save();
    return snapshot(at, sender.tab.id, site);
  }).then(respond, () => respond({ok: false, error: "记录暂时中断，请刷新页面"}));
  return true;
});

chrome.tabs.onActivated.addListener(({tabId}) => {
  const at = Date.now();
  serialized(async () => { C.advance(state, at); state.active = null; await save(); ping(tabId); });
});
chrome.windows.onFocusChanged.addListener(windowId => {
  const at = Date.now();
  serialized(async () => {
    const oldTabId = state.active?.tabId;
    C.advance(state, at); state.active = null; await save();
    ping(oldTabId);
    if (windowId >= 0) await pingActive(windowId);
  });
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url && change.status !== "loading" && change.status !== "complete") return;
  const at = Date.now();
  serialized(async () => {
    C.advance(state, at);
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const nextSite = C.siteForUrl(change.url || tab?.url);
    if (state.active?.tabId === tabId && (state.active.site !== nextSite || change.status === "loading")) state.active = null;
    if (state.sessions[tabId]?.site !== nextSite && change.status !== "loading") delete state.sessions[tabId];
    await save();
    if (nextSite) ping(tabId);
  });
});
chrome.tabs.onRemoved.addListener(tabId => {
  const at = Date.now();
  serialized(async () => {
    C.advance(state, at);
    if (state.active?.tabId === tabId) state.active = null;
    delete state.sessions[tabId];
    await save();
  });
});
chrome.idle.onStateChanged.addListener(status => {
  if (status === "idle") return; // Watching without touching the mouse still counts.
  const at = Date.now();
  serialized(async () => {
    C.advance(state, at);
    if (status === "locked") state.active = null;
    await save();
    await pingActive();
  });
});
