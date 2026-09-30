/* Shared, dependency-free accounting. All durations are milliseconds. */
(() => {
  const SITES = [
    {id: "bilibili", domain: "bilibili.com", label: "B 站"},
    {id: "xiaohongshu", domain: "xiaohongshu.com", label: "小红书"},
    {id: "youtube", domain: "youtube.com", label: "YouTube"}
  ];
  const MAX_GAP = 15000;
  function siteForUrl(url) {
    try {
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) return null;
      const host = parsed.hostname.toLowerCase();
      return SITES.find(s => host === s.domain || host.endsWith("." + s.domain))?.id || null;
    } catch { return null; }
  }
  function dayKey(time = Date.now()) {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function freshState(epoch) {
    return {version: 1, epoch, days: {}, sessions: {}, active: null, position: {x: 1, y: 0}};
  }
  function addInterval(days, site, start, end) {
    while (start < end) {
      const d = new Date(start);
      const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const next = Math.min(end, midnight);
      const key = dayKey(start);
      const row = days[key] ||= {};
      row[site] = (row[site] || 0) + next - start;
      start = next;
    }
  }
  function advance(state, now) {
    const a = state.active;
    if (!a) return;
    const delta = now - a.at;
    // Missing heartbeats (sleep, crash, a frozen page) never turn into hours of usage.
    if (delta > 0 && delta <= MAX_GAP && now - a.lastSeen <= MAX_GAP) {
      addInterval(state.days, a.site, a.at, now);
      const session = state.sessions[a.tabId];
      if (session?.site === a.site) session.ms += delta;
    }
    a.at = now;
  }
  function total(row = {}) { return SITES.reduce((sum, s) => sum + (row[s.id] || 0), 0); }
  function format(ms) {
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map(n => String(n).padStart(2, "0")).join(":");
  }
  globalThis.AwareCore = {SITES, MAX_GAP, siteForUrl, dayKey, freshState, addInterval, advance, total, format};
})();
