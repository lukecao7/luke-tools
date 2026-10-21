const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function worker(url = "https://www.bilibili.com/video/test", existing = {}) {
  let now = new Date("2026-10-09T12:00:00+08:00").getTime();
  let listener;
  let updated;
  let activated;
  let removed;
  let tab = {id: 1, windowId: 1, active: true, url};
  const tabs = new Map([[1, tab]]);
  let focused = true;
  let windowState = "normal";
  let lockState = "active";
  const stored = structuredClone(existing);
  const event = () => ({addListener() {}});
  const sandbox = {
    structuredClone, console, URL,
    Date: class extends Date { static now() { return now; } },
    importScripts() {},
    chrome: {
      storage: {
        local: {async get(key) { return {[key]: structuredClone(stored[key])}; }, async set(value) { Object.assign(stored, structuredClone(value)); }},
        session: {async get() { return {browserEpoch: "test-browser"}; }}
      },
      runtime: {id: "test-extension", getManifest: () => ({version: "1.5.8"}), getURL: file => `chrome-extension://test-extension/${file}`, onMessage: {addListener(fn) { listener = fn; }}},
      tabs: {
        async get(id) { if (!tabs.has(id)) throw new Error("Tab closed"); return {...tabs.get(id)}; },
        async query(query) { return [...tabs.values()].filter(t => !query.active || t.active).map(t => ({...t})); },
        async sendMessage() {}, onActivated: {addListener(fn) { activated = fn; }},
        onUpdated: {addListener(fn) { updated = fn; }}, onRemoved: {addListener(fn) { removed = fn; }}
      },
      windows: {async get() { return {focused, state: windowState}; }, onFocusChanged: event()},
      idle: {async queryState() { return lockState; }, onStateChanged: event()}
    }
  };
  vm.createContext(sandbox);
  for (const name of ["core.js", "background.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", name), "utf8"), sandbox);
  const start = now;
  const sender = {id: "test-extension", frameId: 0, documentId: "video", tab: {id: 1}, url};
  return {
    async heartbeat(receivedMs, playback, observedMs = receivedMs, senderUrl = sender.url, interactionMs = -10000, visible = true, tabId = sender.tab.id) {
      now = start + receivedMs;
      return new Promise(resolve => listener({type: "HEARTBEAT", visible, playback, lastInteractionAt: start + interactionMs, observedAt: start + observedMs}, {
        ...sender, tab: {id: tabId}, documentId: tabId === sender.tab.id ? sender.documentId : `tab-${tabId}`, url: senderUrl
      }, resolve));
    },
    async dashboard(receivedMs) {
      now = start + receivedMs;
      return new Promise(resolve => listener({type: "DASHBOARD"}, {id: "test-extension", url: "chrome-extension://test-extension/popup.html"}, resolve));
    },
    async navigate(receivedMs, url) {
      now = start + receivedMs;
      tab.url = sender.url = url;
      sender.documentId = `document-${receivedMs}`;
      updated(tab.id, {url, status: "complete"});
      return this.dashboard(receivedMs);
    },
    openTab(id, url) { tabs.set(id, {id, windowId: 1, active: false, url}); },
    async activate(receivedMs, id) {
      now = start + receivedMs;
      for (const t of tabs.values()) t.active = t.id === id;
      tab = tabs.get(id);
      sender.tab.id = id;
      sender.url = tab.url;
      sender.documentId = `tab-${id}`;
      activated({tabId: id, windowId: tab.windowId});
      return this.dashboard(receivedMs);
    },
    async closeTab(receivedMs, id) {
      now = start + receivedMs;
      tabs.delete(id);
      removed(id);
      return this.dashboard(receivedMs);
    },
    ledger: () => stored.ledger,
    stored: () => structuredClone(stored),
    setForeground(value) { focused = value; },
    setMinimized(value) { windowState = value ? "minimized" : "normal"; },
    setLocked(value) { lockState = value ? "locked" : "active"; },
    setActive(value) { tab.active = value; },
    setDocument(value) { sender.documentId = value; }
  };
}

test("pause commits only through the event time and stays stopped across heartbeats and dashboard reads", async () => {
  const w = worker();
  await w.heartbeat(0, "playing");
  const paused = await w.heartbeat(3000, "paused", 2000);
  assert.equal(paused.totalMs, 2000);
  assert.equal(paused.sessionMs, 2000);
  assert.equal(paused.running, false);
  assert.equal((await w.heartbeat(10000, "paused")).totalMs, 2000);
  assert.equal((await w.dashboard(12000)).totalMs, 2000);
  assert.equal(w.ledger().active, null);
});

test("resume continues the same session and excludes the complete paused interval", async () => {
  const w = worker();
  await w.heartbeat(0, "playing");
  await w.heartbeat(2000, "paused");
  await w.heartbeat(11000, "playing", 10000);
  const ended = await w.heartbeat(15000, "ended", 14000);
  assert.equal(ended.totalMs, 6000);
  assert.equal(ended.sessionMs, 6000);
  assert.equal(ended.running, false);
  assert.equal((await w.heartbeat(20000, "ended")).totalMs, 6000);
  const date = Object.keys(w.ledger().hours)[0];
  assert.equal(w.ledger().hours[date].bilibili.reduce((sum, ms) => sum + ms, 0), 6000);
});

test("a quick pause and resume delivered together still excludes the pause", async () => {
  const w = worker();
  await w.heartbeat(0, "playing");
  const paused = w.heartbeat(3000, "paused", 2000);
  const resumed = w.heartbeat(3000, "playing", 2500);
  await Promise.all([paused, resumed]);
  assert.equal((await w.heartbeat(4000, "playing")).totalMs, 3500);
});

test("a page without video stops exactly five seconds after the last interaction", async () => {
  const w = worker();
  await w.heartbeat(0, "browsing", 0, undefined, 0);
  const stopped = await w.heartbeat(8000, "browsing", 8000, undefined, 0);
  assert.equal(stopped.totalMs, 5000);
  assert.equal(stopped.running, false);
  assert.equal((await w.dashboard(12000)).totalMs, 5000);
});

test("even an old Studio content script cannot start background accounting", async () => {
  const w = worker("https://studio.youtube.com/channel/test/videos/upload");
  for (const playback of ["browsing", "playing", "paused"]) {
    assert.equal((await w.heartbeat(0, playback)).ok, false);
  }
  assert.equal((await w.dashboard(10000)).totalMs, 0);
  assert.equal(w.ledger().active, null);
  assert.deepEqual(w.ledger().sessions, {});
});

test("entering Studio stops counting and returning to YouTube starts a new session", async () => {
  const youtube = "https://www.youtube.com/";
  const w = worker(youtube);
  await w.heartbeat(0, "browsing", 0, undefined, 0);
  assert.equal((await w.navigate(2000, "https://studio.youtube.com/channel/test/videos")).totalMs, 2000);
  assert.equal(w.ledger().active, null);
  assert.deepEqual(w.ledger().sessions, {});
  // A delayed heartbeat from the old YouTube document cannot restart timing.
  assert.equal((await w.heartbeat(3000, "browsing", 3000, youtube)).running, false);
  assert.equal((await w.heartbeat(10000, "browsing")).ok, false);
  assert.equal((await w.dashboard(12000)).totalMs, 2000);
  await w.navigate(13000, youtube);
  await w.heartbeat(13000, "browsing", 13000, undefined, 13000);
  const resumed = await w.heartbeat(15000, "browsing", 15000, undefined, 13000);
  assert.equal(resumed.totalMs, 4000);
  assert.equal(resumed.sessionMs, 2000);
  assert.equal(resumed.running, true);
});

test("Xiaohongshu scrolling and opening images count even with a paused player", async () => {
  const w = worker("https://www.xiaohongshu.com/explore/test");
  await w.heartbeat(0, "paused", 0, undefined, 0);
  assert.equal((await w.heartbeat(4000, "paused", 4000, undefined, 4000)).totalMs, 4000);
  const stopped = await w.heartbeat(12000, "paused", 12000, undefined, 4000);
  assert.equal(stopped.totalMs, 9000);
  assert.equal(stopped.running, false);
  await w.heartbeat(13000, "paused", 13000, undefined, 13000);
  assert.equal((await w.dashboard(15000)).totalMs, 11000);
  assert.equal((await w.dashboard(21000)).totalMs, 14000);
});

test("Xiaohongshu playback keeps counting without input and an unattended pause stops immediately", async () => {
  const w = worker("https://www.xiaohongshu.com/explore/test");
  await w.heartbeat(0, "playing", 0, undefined, 0);
  assert.equal((await w.heartbeat(4000, "playing", 4000, undefined, 0)).totalMs, 4000);
  assert.equal((await w.heartbeat(10000, "playing", 10000, undefined, 0)).totalMs, 10000);
  assert.equal((await w.heartbeat(15000, "playing", 15000, undefined, 0)).running, true);
  const paused = await w.heartbeat(16000, "paused", 16000, undefined, 0);
  assert.equal(paused.totalMs, 16000);
  assert.equal(paused.running, false);
  assert.equal((await w.dashboard(22000)).totalMs, 16000);
});

for (const site of ["xiaohongshu", "bilibili", "youtube"]) {
  test(`${site}: recent interaction counts paused/ended video, playback counts without interaction`, async () => {
    const w = worker(`https://www.${site}.com/`);
    await w.heartbeat(0, "paused", 0, undefined, 0);
    await w.heartbeat(4000, "ended", 4000, undefined, 4000);
    assert.equal((await w.dashboard(10000)).totalMs, 9000);
    await w.heartbeat(12000, "playing", 12000, undefined, 4000);
    assert.equal((await w.heartbeat(22000, "playing", 22000, undefined, 4000)).totalMs, 19000);
    const paused = await w.heartbeat(26000, "paused", 25000, undefined, 4000);
    assert.equal(paused.totalMs, 22000);
    assert.equal(paused.running, false);
    await w.heartbeat(27000, "paused", 27000, undefined, 27000);
    assert.equal((await w.dashboard(34000)).totalMs, 27000);
  });

  test(`${site}: a pause click keeps counting only through the interaction deadline`, async () => {
    const w = worker(`https://www.${site}.com/`);
    await w.heartbeat(0, "playing");
    await w.heartbeat(8000, "paused", 8000, undefined, 8000);
    assert.equal((await w.dashboard(15000)).totalMs, 13000);
    assert.equal((await w.dashboard(20000)).totalMs, 13000);
  });
}

test("a delayed overlapping interaction extends the deadline without losing time", async () => {
  const w = worker();
  await w.heartbeat(0, "browsing", 0, undefined, 0);
  await w.heartbeat(6000, "browsing", 6000, undefined, 4900);
  assert.equal((await w.dashboard(12000)).totalMs, 9900);
});

test("an interaction after expiry starts fresh without counting the idle gap", async () => {
  const w = worker();
  await w.heartbeat(0, "browsing", 0, undefined, 0);
  await w.heartbeat(8000, "browsing", 7000, undefined, 7000);
  assert.equal((await w.dashboard(12000)).totalMs, 10000);
});

test("the deadline survives a worker restart and dashboard reads", async () => {
  const w = worker();
  await w.heartbeat(0, "browsing", 0, undefined, 0);
  await w.heartbeat(3000, "browsing", 3000, undefined, 0);
  const restarted = worker(undefined, w.stored());
  assert.equal((await restarted.dashboard(8000)).totalMs, 5000);
  assert.equal((await restarted.dashboard(12000)).totalMs, 5000);
});

test("a replacement document cannot display an old document's running state", async () => {
  const w = worker("https://www.xiaohongshu.com/explore/test");
  await w.heartbeat(0, "playing");
  w.setDocument("replacement");
  w.setForeground(false);
  const response = await w.heartbeat(5000, "paused");
  assert.equal(response.running, false);
  const expired = await w.heartbeat(20000, "paused");
  assert.equal(expired.running, false);
  assert.equal(w.ledger().active, null);
  assert.equal((await w.dashboard(25000)).totalMs, 5000);
});

for (const site of ["xiaohongshu", "bilibili", "youtube"]) {
  test(`${site}: visible playback counts in an unfocused window, while a paused idle page stops`, async () => {
    const w = worker(`https://www.${site}.com/`);
    w.setForeground(false);
    const started = await w.heartbeat(0, "playing");
    assert.equal(started.running, true);
    assert.equal(started.reason, "recording");
    const playing = await w.heartbeat(10000, "playing");
    assert.equal(playing.totalMs, 10000);
    assert.equal(playing.running, true);
    const paused = await w.heartbeat(12000, "paused");
    assert.equal(paused.totalMs, 12000);
    assert.equal(paused.running, false);
    assert.equal((await w.dashboard(16000)).totalMs, 12000);
  });
}

test("background tabs, minimized windows and a locked system stop even a playing video", async () => {
  for (const condition of ["hidden", "inactive", "minimized", "locked"]) {
    const w = worker();
    await w.heartbeat(0, "playing");
    if (condition === "inactive") w.setActive(false);
    if (condition === "minimized") w.setMinimized(true);
    if (condition === "locked") w.setLocked(true);
    const stopped = await w.heartbeat(2000, "playing", 2000, undefined, 0, condition !== "hidden");
    assert.equal(stopped.running, false, condition);
    assert.equal((await w.dashboard(10000)).totalMs, 2000, condition);
  }
});

for (const site of ["bilibili", "xiaohongshu", "youtube"]) {
  test(`${site}: homepage, new video tabs and closing videos share one session without double counting`, async () => {
    const home = `https://www.${site}.com/`;
    const w = worker(home);
    await w.heartbeat(0, "browsing", 0, home, 0);
    w.openTab(2, home + "video/first");
    await w.activate(2000, 2);
    const opened = await w.heartbeat(2000, "playing");
    assert.equal(opened.sessionMs, 2000);
    assert.equal((await w.heartbeat(10000, "playing")).sessionMs, 10000);
    // The homepage's background heartbeat reads the same shared session.
    const hidden = await w.heartbeat(10000, "browsing", 10000, home, 0, false, 1);
    assert.equal(hidden.sessionMs, 10000);
    await w.closeTab(11000, 2);
    await w.activate(11000, 1);
    const returned = await w.heartbeat(11000, "browsing", 11000, home, 11000);
    assert.equal(returned.sessionMs, 11000);
    assert.equal(returned.totalMs, 11000);
    assert.equal(returned.siteMs, 11000);
    w.openTab(3, home + "video/second");
    await w.activate(12000, 3);
    await w.heartbeat(12000, "playing");
    await w.closeTab(15000, 3);
    await w.activate(15000, 1);
    await w.heartbeat(15000, "browsing", 15000, home, 15000);
    const secondReturn = await w.heartbeat(16000, "browsing", 16000, home, 15000);
    assert.equal(secondReturn.sessionMs, 16000);
    assert.equal(secondReturn.totalMs, 16000);
    const date = Object.keys(w.ledger().hours)[0];
    assert.equal(w.ledger().hours[date][site].reduce((sum, ms) => sum + ms, 0), 16000);
  });
}

test("closing the last site tab ends its session but preserves daily time", async () => {
  const home = "https://www.bilibili.com/";
  const w = worker(home);
  await w.heartbeat(0, "playing");
  await w.closeTab(4000, 1);
  assert.deepEqual(w.ledger().sessions, {});
  w.openTab(2, home);
  await w.activate(8000, 2);
  const reopened = await w.heartbeat(8000, "playing");
  assert.equal(reopened.sessionMs, 0);
  const playing = await w.heartbeat(10000, "playing");
  assert.equal(playing.sessionMs, 2000);
  assert.equal(playing.totalMs, 6000);
});

test("leaving one of several site tabs keeps its session; leaving the last one ends it", async () => {
  const home = "https://www.bilibili.com/";
  const w = worker(home);
  w.openTab(2, home + "video/test");
  await w.heartbeat(0, "playing");
  await w.navigate(2000, "https://example.com/");
  assert.equal(w.ledger().sessions.bilibili.ms, 2000);
  await w.activate(3000, 2);
  assert.equal((await w.heartbeat(3000, "playing")).sessionMs, 2000);
  await w.navigate(5000, "https://example.com/");
  assert.deepEqual(w.ledger().sessions, {});
  await w.navigate(6000, home);
  assert.equal((await w.heartbeat(6000, "playing")).sessionMs, 0);
  assert.equal((await w.heartbeat(7000, "playing")).totalMs, 5000);
});

test("different websites keep separate sessions when switching tabs", async () => {
  const w = worker("https://www.bilibili.com/");
  await w.heartbeat(0, "playing");
  w.openTab(2, "https://www.youtube.com/");
  await w.activate(2000, 2);
  assert.equal((await w.heartbeat(2000, "playing")).sessionMs, 0);
  await w.activate(5000, 1);
  assert.equal((await w.heartbeat(5000, "playing")).sessionMs, 2000);
  const returned = await w.heartbeat(7000, "playing");
  assert.equal(returned.sessionMs, 4000);
  assert.equal(returned.totalMs, 7000);
  assert.equal(w.ledger().sessions.youtube.ms, 3000);
});

test("upgrading tab sessions and restarting the worker preserves shared time exactly once", async () => {
  const w = worker("https://www.bilibili.com/", {ledger: {
    version: 3, epoch: "test-browser", active: null, position: {x: 1, y: 0},
    days: {"2026-10-09": {bilibili: 17000}},
    hours: {"2026-10-09": {bilibili: Array.from({length: 24}, (_, i) => i === 12 ? 17000 : 0)}},
    sessions: {1: {site: "bilibili", ms: 2000}, 2: {site: "bilibili", ms: 15000}}
  }});
  w.openTab(2, "https://www.bilibili.com/video/test");
  const upgraded = await w.heartbeat(0, "playing");
  assert.equal(upgraded.sessionMs, 17000);
  assert.equal(upgraded.totalMs, 17000);
  assert.equal(upgraded.hourly.bilibili[12], 17000);
  assert.equal(w.stored().ledgerBeforeSharedSessions.version, 3);
  const restarted = worker("https://www.bilibili.com/", w.stored());
  const resumed = await restarted.heartbeat(2000, "playing");
  assert.equal(resumed.sessionMs, 19000);
  assert.equal(resumed.totalMs, 19000);
  assert.equal(restarted.ledger().version, 4);
});
