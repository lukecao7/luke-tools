/* Shared statistics view for the toolbar popup and floating reminder. */
(() => {
  const STYLE = `.stats-view {
  color-scheme: light;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #353443;
  background: #fff;
  box-sizing: border-box; padding: calc(16px * var(--stats-scale, 1)) calc(20px * var(--stats-scale, 1)); width: 100%; min-width: 0; font-size: calc(13px * var(--stats-scale, 1)); line-height: 1.5;
  container-type: inline-size; container-name: aware-stats;
}
.stats-view * { box-sizing: border-box; }
.stats-view [hidden] { display: none !important; }
.stats-view header { display: flex; gap: calc(10px * var(--stats-scale, 1)); align-items: center; margin-bottom: calc(16px * var(--stats-scale, 1)); }
.stats-view h1 { white-space: nowrap; font-size: calc(16px * var(--stats-scale, 1)); margin: 0; font-weight: 600; }
.stats-view header p { white-space: nowrap; font-size: calc(12px * var(--stats-scale, 1)); color: #7a7389; margin: calc(3px * var(--stats-scale, 1)) 0 0; }
.stats-view .badge { flex-shrink: 0; white-space: nowrap; margin-left: auto; padding: calc(4px * var(--stats-scale, 1)) calc(7px * var(--stats-scale, 1)); border-radius: calc(5px * var(--stats-scale, 1)); background: #f5f3fc; color: #7461a0; font-size: calc(11px * var(--stats-scale, 1)); }
.stats-view .total { display: flex; align-items: center; justify-content: space-between; gap: calc(16px * var(--stats-scale, 1)); background: #f7f6fa; border-radius: calc(10px * var(--stats-scale, 1)); padding: calc(12px * var(--stats-scale, 1)) calc(16px * var(--stats-scale, 1)); }
.stats-view .total span { font-size: calc(12px * var(--stats-scale, 1)); color: #777180; }
.stats-view .total strong { display: block; margin-top: calc(3px * var(--stats-scale, 1)); color: #534d66;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-variant-numeric: tabular-nums; white-space: nowrap; font-size: calc(28px * var(--stats-scale, 1)); line-height: 1.25; font-weight: 600; letter-spacing: -.5px; }
.stats-view .total small { display: block; text-align: right; font-size: calc(11px * var(--stats-scale, 1)); line-height: 1.7; color: #8a8494; }
.stats-view .total .stats-date { display: block; color: #696372; font-size: inherit; }
.stats-view .distribution-heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: calc(16px * var(--stats-scale, 1)) 0 calc(2px * var(--stats-scale, 1)); }
.stats-view .distribution-heading h2 { margin: 0; font-size: calc(12px * var(--stats-scale, 1)); font-weight: 600; color: #696372; }
.stats-view .distribution-heading span { font-size: calc(10px * var(--stats-scale, 1)); color: #938c9d; }
.stats-view .sites { padding-bottom: calc(8px * var(--stats-scale, 1)); }
.stats-view .site-card { --site-color: #9587bc; padding: calc(10px * var(--stats-scale, 1)) 0; }
.stats-view .site-card[data-empty="true"] { padding: calc(7px * var(--stats-scale, 1)) 0; }
.stats-view .site-card + .site-card { border-top: 1px solid #f0edf4; }
.stats-view .site-card[data-site="xiaohongshu"] { --site-color: #c9859b; }
.stats-view .site-card[data-site="youtube"] { --site-color: #769dcc; }
.stats-view .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: calc(3px * var(--stats-scale, 1)) 0; font-size: calc(13px * var(--stats-scale, 1)); }
.stats-view .row strong { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-variant-numeric: tabular-nums; white-space: nowrap; font-size: calc(14px * var(--stats-scale, 1)); font-weight: 500; color: #615c6b; }
.stats-view .site-name { display: flex; gap: calc(7px * var(--stats-scale, 1)); align-items: center; }
.stats-view .empty-label { margin-left: calc(3px * var(--stats-scale, 1)); font-size: calc(10px * var(--stats-scale, 1)); color: #a09aaa; }
.stats-view .site-card[data-empty="true"] .row strong { color: #a09aaa; }
.stats-view .dot { flex: none; width: calc(6px * var(--stats-scale, 1)); height: calc(6px * var(--stats-scale, 1)); border-radius: 50%; background: var(--site-color); }
.stats-view .chart-readout { min-height: calc(16px * var(--stats-scale, 1)); margin: calc(4px * var(--stats-scale, 1)) 0 calc(6px * var(--stats-scale, 1)); font-size: calc(10px * var(--stats-scale, 1)); color: #8c8596; }
.stats-view .hour-bars { height: calc(64px * var(--stats-scale, 1)); display: grid; grid-template-columns: repeat(24, minmax(0, 1fr)); gap: calc(2px * var(--stats-scale, 1));
  border-bottom: 1px solid #e9e5f0;
  background: linear-gradient(to bottom, #f0edf5 1px, transparent 1px, transparent calc(50% - .5px), #f0edf5 calc(50% - .5px), #f0edf5 calc(50% + .5px), transparent calc(50% + .5px)); }
.stats-view .hour-bin { min-width: 0; height: 100%; padding: 0; border: 0; background: transparent;
  display: flex; align-items: flex-end; cursor: help; }
.stats-view .hour-bin[data-next-day="true"] { background: #f6f4fa; }
.stats-view .hour-fill { display: block; width: 100%; min-height: calc(2px * var(--stats-scale, 1)); border-radius: calc(2px * var(--stats-scale, 1)) calc(2px * var(--stats-scale, 1)) 0 0;
  background: var(--site-color); pointer-events: none; }
.stats-view .hour-bin[data-empty="true"] .hour-fill { min-height: 0; }
.stats-view .hour-bin[data-selected="true"] { background: #eae5f5; }
.stats-view .hour-bin[data-selected="true"] .hour-fill { filter: brightness(.8); }
.stats-view .hour-bin:focus-visible { outline: calc(2px * var(--stats-scale, 1)) solid var(--site-color); outline-offset: calc(1px * var(--stats-scale, 1)); }
.stats-view .hour-axis { position: relative; height: calc(18px * var(--stats-scale, 1)); margin-top: calc(5px * var(--stats-scale, 1));
  font-size: calc(10px * var(--stats-scale, 1)); color: #8b819a; font-variant-numeric: tabular-nums; }
.stats-view .hour-axis span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
.stats-view .hour-axis span:first-child { transform: none; }
.stats-view .hour-axis span:last-child { transform: translateX(-100%); }
.stats-view .chart-note { margin: calc(6px * var(--stats-scale, 1)) 0 0; font-size: calc(10px * var(--stats-scale, 1)); line-height: 1.6; color: #8b819a; }
.stats-view .history { border-top: calc(1px * var(--stats-scale, 1)) solid #eeecf4; padding-top: calc(13px * var(--stats-scale, 1)); }
.stats-view .history summary { display: flex; align-items: center; justify-content: space-between; list-style: none; cursor: pointer; font-size: calc(12px * var(--stats-scale, 1)); color: #7a7389; }
.stats-view .history summary::-webkit-details-marker { display: none; }
.stats-view .history summary::after { content: "展开 +"; font-size: calc(10px * var(--stats-scale, 1)); color: #9b94a6; }
.stats-view .history[open] summary::after { content: "收起 −"; }
.stats-view .history summary:focus-visible { outline: 2px solid #9587bc; outline-offset: 3px; border-radius: 3px; }
.stats-view .history-rows { margin-top: calc(6px * var(--stats-scale, 1)); }
.stats-view .history .row { padding: calc(5px * var(--stats-scale, 1)) 0; font-size: calc(11px * var(--stats-scale, 1)); color: #7a7389; }
.stats-view .history .row strong { font-size: calc(12px * var(--stats-scale, 1)); color: #7a7389; }
.stats-view footer { display: flex; align-items: baseline; gap: calc(5px * var(--stats-scale, 1)); margin-top: calc(12px * var(--stats-scale, 1));
  font-size: calc(10px * var(--stats-scale, 1)); color: #96909f; }
.stats-view .footer-dot { width: calc(4px * var(--stats-scale, 1)); height: calc(4px * var(--stats-scale, 1)); border-radius: 50%; background: #aaa0c7; }

.stats-view header img { flex-shrink: 0; width: calc(32px * var(--stats-scale, 1)); height: calc(32px * var(--stats-scale, 1)); }
.stats-view .brand-text { min-width: 0; }
@container aware-stats (max-width: 360px) {
  .stats-view .total { align-items: flex-start; flex-direction: column; gap: 6px; }
  .stats-view .total small { text-align: left; }
  .stats-view .total .stats-date { display: inline; margin-right: 6px; }
  .stats-view .badge { display: none; }
}
`;
  const C = AwareCore;
  const HOURS = Array.from({length: 24}, (_, index) => (index + C.DAY_START_HOUR) % 24);
function duration(ms) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  if (!seconds) return ms > 0 ? "不足 1 秒" : "0 分钟";
  const parts = [];
  if (seconds >= 3600) parts.push(`${Math.floor(seconds / 3600)} 小时`);
  if (seconds % 3600 >= 60) parts.push(`${Math.floor(seconds / 60) % 60} 分`);
  if (seconds % 60) parts.push(`${seconds % 60} 秒`);
  return parts.join(" ");
}
function hourLabel(hour) {
  return `${hour < C.DAY_START_HOUR ? "次日 " : ""}${String(hour).padStart(2, "0")}:00–${hour === 23 ? "次日 00" : String(hour + 1).padStart(2, "0")}:00`;
}
function row(label, value, site = false) {
  const item = document.createElement("div"); item.className = "row";
  const name = document.createElement("span"); name.textContent = label;
  if (site) {
    name.className = "site-name";
    const dot = document.createElement("i"); dot.className = "dot"; name.prepend(dot);
  }
  const time = document.createElement("strong"); time.textContent = C.format(value);
  item.append(name, time); return item;
}
function siteCard(site) {
  const card = document.createElement("section");
  card.className = "site-card";
  card.dataset.site = site.id;
  const heading = row(site.label, 0, true);
  const totalEl = heading.querySelector("strong");
  const emptyLabel = document.createElement("small");
  emptyLabel.className = "empty-label";
  emptyLabel.textContent = "暂无记录";
  heading.querySelector(".site-name").append(emptyLabel);
  const chart = document.createElement("div");
  chart.className = "hourly";
  const readout = document.createElement("p");
  readout.className = "chart-readout";
  const bars = document.createElement("div");
  bars.className = "hour-bars";
  bars.setAttribute("role", "group");
  const bins = HOURS.map(hour => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hour-bin";
    button.dataset.hour = hour;
    button.dataset.nextDay = String(hour < C.DAY_START_HOUR);
    button.dataset.empty = "true";
    const fill = document.createElement("span");
    fill.className = "hour-fill";
    fill.setAttribute("aria-hidden", "true");
    button.append(fill);
    bars.append(button);
    return {button, fill, hour};
  });
  const axis = document.createElement("div");
  axis.className = "hour-axis";
  axis.setAttribute("aria-hidden", "true");
  for (const [index, text] of ["6", "12", "18", "次日 0", "次日 6"].entries()) {
    const label = document.createElement("span");
    label.textContent = text;
    label.style.left = `${index * 25}%`;
    axis.append(label);
  }
  const note = document.createElement("p");
  note.className = "chart-note";
  chart.append(readout, bars, axis);
  card.append(heading, chart, note);
  let values = Array(24).fill(0);
  let hoveredHour = null;
  function showHour() {
    const focused = bars.getRootNode().activeElement;
    const hour = hoveredHour ?? (bars.contains(focused) ? Number(focused.dataset.hour) : null);
    readout.textContent = hour === null ? "移入或选择时段，查看具体时长" : `${hourLabel(hour)} · ${duration(values[hour])}`;
    for (const bin of bins) bin.button.dataset.selected = String(bin.hour === hour);
  }
  bins.forEach(({button, hour}) => button.addEventListener("pointerenter", () => { hoveredHour = hour; showHour(); }));
  bars.addEventListener("pointerleave", () => { hoveredHour = null; showHour(); });
  bars.addEventListener("focusin", showHour);
  bars.addEventListener("focusout", () => queueMicrotask(showHour));
  return {
    element: card,
    update(data) {
      const totalMs = data.today[site.id] || 0;
      totalEl.textContent = C.format(totalMs);
      values = Array.from({length: 24}, (_, hour) => Math.max(0, data.hourly?.[site.id]?.[hour] || 0));
      bins.forEach(({button, fill, hour}) => {
        const text = `${site.label} ${hourLabel(hour)}：${duration(values[hour])}`;
        button.setAttribute("aria-label", text);
        button.title = text;
        button.dataset.empty = String(values[hour] === 0);
        fill.style.height = `${Math.min(100, values[hour] / 3600000 * 100)}%`;
      });
      const missing = Math.max(0, totalMs - values.reduce((sum, ms) => sum + ms, 0));
      card.dataset.empty = String(totalMs === 0);
      emptyLabel.hidden = totalMs > 0;
      chart.hidden = !values.some(ms => ms > 0);
      note.hidden = missing === 0;
      note.textContent = missing > 0 ? `另有 ${duration(missing)} 升级前时长，没有小时明细。` : "";
      bars.setAttribute("aria-label", `${site.label} ${data.date} 的早上 6 点至次日早上 6 点浏览分布`);
      showHour();
    }
  };
}

  function create(container, {showBrand = true} = {}) {
    const view = document.createElement("div");
    view.className = "stats-view";
    view.innerHTML = `<style>${STYLE}</style>
      ${showBrand ? '<header><img src="icons/48.png" width="32" height="32" alt=""><div class="brand-text"><h1>别刷忘了</h1><p>网页使用时长</p></div><span class="badge">常驻提醒</span></header>' : ''}
      <section class="total"><div><span>今日累计</span><strong class="stats-total">00:00:00</strong></div><small class="stats-status">正在读取记录</small></section>
      <div class="distribution-heading"><h2>每小时分布</h2><span>满格 60 分钟 · 浅色为次日</span></div>
      <section class="sites" aria-label="各网站使用时长与小时分布"></section>
      <details class="history"><summary>最近记录</summary><div class="history-rows"></div></details>
      <footer><span class="footer-dot"></span>仅记录前台浏览 · 本机保存 90 个使用日</footer>`;
    const cards = C.SITES.map(siteCard);
    view.querySelector(".sites").replaceChildren(...cards.map(card => card.element));
    container.append(view);
    return {
      update(data) {
        view.querySelector(".stats-total").textContent = C.format(data.totalMs);
        const status = view.querySelector(".stats-status");
        const date = document.createElement("span");
        date.className = "stats-date";
        date.textContent = data.date;
        status.replaceChildren(date, "06:00 – 次日 06:00");
        cards.forEach(card => card.update(data));
        view.querySelector(".history-rows").replaceChildren(...(data.history.length ? data.history : [{date: data.date, ms: 0}]).map(d => row(d.date, d.ms)));
      },
      status(text) { view.querySelector(".stats-status").textContent = text; }
    };
  }
  globalThis.AwareStats = {create};
})();
