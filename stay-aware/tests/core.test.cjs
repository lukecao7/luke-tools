const test = require("node:test");
const assert = require("node:assert/strict");
process.env.TZ = "Asia/Shanghai";
require("../core.js");
const C = globalThis.AwareCore;
const at = value => new Date(value).getTime();

test("all sites share one interaction-or-playback recording rule", () => {
  assert.equal(C.recordingUntil("playing", 1000), null);
  assert.equal(C.recordingUntil("playing", undefined), null);
  for (const playback of ["browsing", "paused", "ended"]) assert.equal(C.recordingUntil(playback, 1000), 6000);
  assert.equal(C.recordingUntil("browsing", undefined), 0);
});

test("an inactivity deadline caps total, session and hourly time at precisely five seconds", () => {
  const start = at("2026-10-10T05:59:57+08:00");
  const state = C.freshState("browser");
  state.sessions.xiaohongshu = {site: "xiaohongshu", ms: 0};
  state.active = {site: "xiaohongshu", tabId: 1, at: start, lastSeen: start, countUntil: start + 5000};
  C.advance(state, start + 8000);
  assert.equal(state.sessions.xiaohongshu.ms, 5000);
  assert.deepEqual(state.days, {"2026-10-09": {xiaohongshu: 3000}, "2026-10-10": {xiaohongshu: 2000}});
  assert.equal(state.hours["2026-10-09"].xiaohongshu[5], 3000);
  assert.equal(state.hours["2026-10-10"].xiaohongshu[6], 2000);
  assert.equal(state.active, null);
  C.advance(state, start + 12000);
  assert.equal(state.sessions.xiaohongshu.ms, 5000);
});

test("an expired heartbeat clears the active owner instead of keeping a phantom running timer", () => {
  const start = at("2026-10-13T20:00:00+08:00");
  const state = C.freshState("browser");
  state.active = {site: "xiaohongshu", tabId: 1, at: start, lastSeen: start, countUntil: null};
  state.sessions.xiaohongshu = {site: "xiaohongshu", ms: 0};
  C.advance(state, start + C.MAX_GAP + 1);
  assert.equal(state.active, null);
  assert.equal(state.sessions.xiaohongshu.ms, 0);
  C.advance(state, start + C.MAX_GAP + 5000);
  assert.equal(state.sessions.xiaohongshu.ms, 0);
});

test("YouTube Studio management pages are excluded while browsing sites stay supported", () => {
  for (const url of [
    "https://studio.youtube.com/channel/test/videos/upload?filter=all",
    "http://studio.youtube.com/", "https://STUDIO.YOUTUBE.COM/video/test/edit",
    "https://preview.studio.youtube.com/"
  ]) assert.equal(C.siteForUrl(url), null, url);
  for (const url of ["https://youtube.com/", "https://www.youtube.com/watch?v=test", "https://m.youtube.com/shorts/test", "https://music.youtube.com/"])
    assert.equal(C.siteForUrl(url), "youtube", url);
  assert.equal(C.siteForUrl("https://www.bilibili.com/"), "bilibili");
  assert.equal(C.siteForUrl("https://www.xiaohongshu.com/explore"), "xiaohongshu");
  for (const url of ["https://youtube.com.example.com/", "file:///youtube.com", "invalid"])
    assert.equal(C.siteForUrl(url), null, url);
});

test("midnight stays in the same usage day; exactly 06:00 starts the next", () => {
  assert.equal(C.dayKey(at("2026-10-09T23:59:59+08:00")), "2026-10-09");
  assert.equal(C.dayKey(at("2026-10-10T00:00:00+08:00")), "2026-10-09");
  assert.equal(C.dayKey(at("2026-10-10T05:59:59+08:00")), "2026-10-09");
  assert.equal(C.dayKey(at("2026-10-10T06:00:00+08:00")), "2026-10-10");
});

test("early morning handles year and leap-month boundaries", () => {
  assert.equal(C.dayKey(at("2027-01-01T02:00:00+08:00")), "2026-12-31");
  assert.equal(C.dayKey(at("2024-03-01T02:00:00+08:00")), "2024-02-29");
});

test("an interval crossing midnight is recorded once in the previous day", () => {
  const days = {};
  C.addInterval(days, "youtube", at("2026-10-09T23:59:55+08:00"), at("2026-10-10T00:00:05+08:00"));
  assert.deepEqual(days, {"2026-10-09": {youtube: 10000}});
});

test("06:00 splits the daily total while the session continues", () => {
  const start = at("2026-10-10T05:59:55+08:00");
  const state = C.freshState("browser");
  state.sessions.youtube = {site: "youtube", ms: 60000};
  state.active = {site: "youtube", tabId: 1, at: start, lastSeen: start};
  C.advance(state, start + 10000);
  assert.deepEqual(state.days, {"2026-10-09": {youtube: 5000}, "2026-10-10": {youtube: 5000}});
  assert.equal(state.sessions.youtube.ms, 70000);
  C.advance(state, start + 10000);
  assert.equal(state.sessions.youtube.ms, 70000);
});

test("early-morning upgrade merges the current calendar day once and keeps all time", () => {
  const old = {version: 1, epoch: "browser", days: {"2026-10-09": {youtube: 60000}, "2026-10-10": {youtube: 10000, bilibili: 5000}}, sessions: {1: {site: "youtube", ms: 70000}}, position: {x: 0.5, y: 0.8}, active: null};
  const upgraded = C.upgradeState(old, at("2026-10-10T02:00:00+08:00"));
  assert.equal(upgraded.version, 4);
  assert.equal(upgraded.days["2026-10-09"].youtube, 70000);
  assert.equal(upgraded.days["2026-10-09"].bilibili, 5000);
  assert.equal(upgraded.days["2026-10-10"], undefined);
  assert.deepEqual(upgraded.sessions, {youtube: {site: "youtube", ms: 70000}});
  assert.deepEqual(upgraded.position, old.position);
  assert.deepEqual(C.upgradeState(upgraded, at("2026-10-10T02:00:00+08:00")), upgraded);
  assert.equal(old.version, 1);
  assert.equal(old.days["2026-10-10"].youtube, 10000);
});

test("daytime upgrade preserves existing daily aggregates", () => {
  const old = {version: 1, days: {"2026-10-09": {youtube: 60000}, "2026-10-10": {youtube: 10000}}};
  const upgraded = C.upgradeState(old, at("2026-10-10T08:00:00+08:00"));
  assert.deepEqual(upgraded.days, old.days);
});

test("v3 tab sessions merge by site once while daily and hourly history stay unchanged", () => {
  const old = {version: 3, days: {"2026-10-19": {bilibili: 12000, youtube: 3000}},
    hours: {"2026-10-19": {bilibili: Array(24).fill(500)}},
    sessions: {1: {site: "bilibili", ms: 2000}, 2: {site: "bilibili", ms: 10000}, 3: {site: "youtube", ms: 3000}}, active: null};
  const upgraded = C.upgradeState(old);
  assert.equal(upgraded.version, 4);
  assert.deepEqual(upgraded.sessions, {bilibili: {site: "bilibili", ms: 12000}, youtube: {site: "youtube", ms: 3000}});
  assert.deepEqual(upgraded.days, old.days);
  assert.deepEqual(upgraded.hours, old.hours);
  assert.deepEqual(C.upgradeState(upgraded), upgraded);
  assert.equal(old.version, 3);
});

test("sleep across the cutoff does not create usage", () => {
  const start = at("2026-10-10T05:59:55+08:00");
  const state = C.freshState("browser");
  state.sessions.youtube = {site: "youtube", ms: 60000};
  state.active = {site: "youtube", tabId: 1, at: start, lastSeen: start};
  C.advance(state, start + 3600000);
  assert.deepEqual(state.days, {});
  assert.equal(state.sessions.youtube.ms, 60000);
});

test("local 06:00 remains the cutoff on a daylight-saving transition", () => {
  process.env.TZ = "America/New_York";
  try {
    assert.equal(C.dayKey(at("2026-03-08T05:59:59-04:00")), "2026-03-07");
    const days = {};
    C.addInterval(days, "youtube", at("2026-03-08T05:59:55-04:00"), at("2026-03-08T06:00:05-04:00"));
    assert.deepEqual(days, {"2026-03-07": {youtube: 5000}, "2026-03-08": {youtube: 5000}});
  } finally { process.env.TZ = "Asia/Shanghai"; }
});

test("crossing a clock hour divides the exact duration between both bars", () => {
  const state = C.freshState("browser");
  C.addInterval(state.days, "bilibili", at("2026-10-09T09:59:55+08:00"), at("2026-10-09T10:00:05+08:00"), state.hours);
  const bins = state.hours["2026-10-09"].bilibili;
  assert.equal(bins.length, 24);
  assert.equal(bins[9], 5000);
  assert.equal(bins[10], 5000);
  assert.equal(bins.reduce((sum, ms) => sum + ms, 0), state.days["2026-10-09"].bilibili);
});

test("midnight separates clock hours without separating the usage day", () => {
  const state = C.freshState("browser");
  C.addInterval(state.days, "bilibili", at("2026-10-09T23:59:55+08:00"), at("2026-10-10T00:00:05+08:00"), state.hours);
  assert.equal(state.hours["2026-10-09"].bilibili[23], 5000);
  assert.equal(state.hours["2026-10-09"].bilibili[0], 5000);
  assert.equal(state.hours["2026-10-10"], undefined);
});

test("06:00 assigns hourly bins to different usage days", () => {
  const state = C.freshState("browser");
  C.addInterval(state.days, "youtube", at("2026-10-10T05:59:55+08:00"), at("2026-10-10T06:00:05+08:00"), state.hours);
  assert.equal(state.hours["2026-10-09"].youtube[5], 5000);
  assert.equal(state.hours["2026-10-10"].youtube[6], 5000);
  for (const date of Object.keys(state.days)) assert.equal(state.hours[date].youtube.reduce((sum, ms) => sum + ms, 0), state.days[date].youtube);
});

test("multiple foreground intervals accumulate by hour and site", () => {
  const state = C.freshState("browser");
  for (const [site, start, end] of [
    ["bilibili", "09:00:00", "09:20:00"], ["bilibili", "09:30:00", "09:45:00"],
    ["youtube", "10:00:00", "10:30:00"], ["bilibili", "22:00:00", "23:00:00"]
  ]) C.addInterval(state.days, site, at(`2026-10-09T${start}+08:00`), at(`2026-10-09T${end}+08:00`), state.hours);
  assert.equal(state.hours["2026-10-09"].bilibili[9], 35 * 60000);
  assert.equal(state.hours["2026-10-09"].bilibili[22], 60 * 60000);
  assert.equal(state.hours["2026-10-09"].youtube[10], 30 * 60000);
  assert.equal(state.hours["2026-10-09"].bilibili[10], 0);
});

test("sleep and replay cannot inflate either totals or hourly bars", () => {
  const start = at("2026-10-09T09:59:55+08:00");
  const state = C.freshState("browser");
  state.active = {site: "bilibili", tabId: 1, at: start, lastSeen: start};
  state.sessions[1] = {site: "bilibili", ms: 0};
  C.advance(state, start + 10000);
  C.advance(state, start + 10000);
  C.advance(state, start + 3600000);
  assert.equal(C.total(state.days["2026-10-09"]), 10000);
  assert.equal(state.hours["2026-10-09"].bilibili.reduce((sum, ms) => sum + ms, 0), 10000);
});

test("version 2 upgrade preserves totals without inventing hourly history", () => {
  const old = {version: 2, days: {"2026-10-09": {bilibili: 6 * 3600000}}, sessions: {}, active: null, position: {x: 1, y: 0}};
  const upgraded = C.upgradeState(old, at("2026-10-09T22:00:00+08:00"));
  assert.equal(upgraded.version, 4);
  assert.deepEqual(upgraded.days, old.days);
  assert.deepEqual(upgraded.hours, {});
  C.addInterval(upgraded.days, "bilibili", at("2026-10-09T22:00:00+08:00"), at("2026-10-09T22:01:00+08:00"), upgraded.hours);
  assert.equal(upgraded.hours["2026-10-09"].bilibili[22], 60000);
  assert.equal(upgraded.days["2026-10-09"].bilibili, 6 * 3600000 + 60000);
  assert.deepEqual(C.upgradeState(upgraded), upgraded);
  assert.equal(old.version, 2);
});
