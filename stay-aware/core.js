/* Shared, dependency-free accounting. All durations are milliseconds. */
(() => {
  const SITES = [
    {id: "bilibili", domain: "bilibili.com", label: "B 站"},
    {id: "xiaohongshu", domain: "xiaohongshu.com", label: "小红书"},
    {id: "youtube", domain: "youtube.com", label: "YouTube"}
  ];
  const MAX_GAP = 15000;
  const INTERACTION_TIMEOUT = 5000;
  const DAY_START_HOUR = 6;
  function recordingUntil(playback, lastInteractionAt) {
    if (playback === "playing") return null;
    return Number.isFinite(lastInteractionAt) ? lastInteractionAt + INTERACTION_TIMEOUT : 0;
  }
  function siteForUrl(url) {
    try {
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) return null;
      const host = parsed.hostname.toLowerCase();
      // Creator management is work, so Studio never contributes browsing time.
      if (host === "studio.youtube.com" || host.endsWith(".studio.youtube.com")) return null;
      return SITES.find(s => host === s.domain || host.endsWith("." + s.domain))?.id || null;
    } catch { return null; }
  }
  function dayKey(time = Date.now()) {
    const d = new Date(time);
    // Use local calendar arithmetic so a DST change still rolls over at 06:00.
    if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function freshState(epoch) {
    return {version: 4, epoch, days: {}, hours: {}, sessions: {}, active: null, position: {x: 1, y: 0}};
  }
  function upgradeState(ledger, now = Date.now()) {
    const next = structuredClone(ledger);
    if (next.version === 4) return next;
    // Before 06:00, all of the current calendar day's existing time belongs
    // to the previous usage day. Older aggregates have no hourly breakdown.
    const d = new Date(now);
    if (next.version === 1 && d.getHours() < DAY_START_HOUR) {
      const calendarKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const row = next.days[calendarKey];
      if (row) {
        const target = next.days[dayKey(now)] ||= {};
        for (const s of SITES) target[s.id] = (target[s.id] || 0) + (row[s.id] || 0);
        delete next.days[calendarKey];
      }
    }
    // Daily aggregates cannot reveal when old browsing took place.
    if (next.version < 3) next.hours = {};
    // Old sessions were per tab. Their intervals never overlapped, so merge
    // them once per site without changing the daily or hourly ledger.
    const sessions = {};
    for (const session of Object.values(next.sessions || {})) {
      if (!SITES.some(s => s.id === session.site)) continue;
      const shared = sessions[session.site] ||= {site: session.site, ms: 0};
      shared.ms += session.ms;
    }
    next.sessions = sessions;
    next.version = 4;
    return next;
  }
  function addInterval(days, site, start, end, hours) {
    while (start < end) {
      const d = new Date(start);
      // Split at each local clock hour, including 06:00. Elapsed-time
      // arithmetic also handles a repeated/skipped hour on DST changes.
      const nextHour = start + (60 - d.getMinutes()) * 60000 - d.getSeconds() * 1000 - d.getMilliseconds();
      const next = Math.min(end, nextHour);
      const key = dayKey(start);
      const row = days[key] ||= {};
      row[site] = (row[site] || 0) + next - start;
      if (hours) {
        const bins = (hours[key] ||= {})[site] ||= Array(24).fill(0);
        bins[d.getHours()] += next - start;
      }
      start = next;
    }
  }
  function advance(state, now) {
    const a = state.active;
    if (!a) return;
    // An expired heartbeat is no longer an active owner. Keeping it alive
    // makes another document appear to run while no interval is persisted.
    if (now - a.lastSeen > MAX_GAP || now - a.at > MAX_GAP) {
      state.active = null;
      return;
    }
    const end = Number.isFinite(a.countUntil) ? Math.min(now, a.countUntil) : now;
    const delta = end - a.at;
    // Missing heartbeats (sleep, crash, a frozen page) never turn into hours of usage.
    if (delta > 0) {
      addInterval(state.days, a.site, a.at, end, state.hours ||= {});
      const session = state.sessions[a.site];
      if (session?.site === a.site) session.ms += delta;
    }
    a.at = now;
    if (Number.isFinite(a.countUntil) && now >= a.countUntil) state.active = null;
  }
  function total(row = {}) { return SITES.reduce((sum, s) => sum + (row[s.id] || 0), 0); }
  function format(ms) {
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map(n => String(n).padStart(2, "0")).join(":");
  }
  globalThis.AwareCore = {SITES, MAX_GAP, INTERACTION_TIMEOUT, DAY_START_HOUR, recordingUntil, siteForUrl, dayKey, freshState, upgradeState, addInterval, advance, total, format};
})();
