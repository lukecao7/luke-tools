const C = AwareCore;
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
async function refresh() {
  try {
    const data = await chrome.runtime.sendMessage({type: "DASHBOARD"});
    if (!data?.ok) throw new Error();
    document.querySelector("#total").textContent = C.format(data.totalMs);
    document.querySelector("#status").textContent = `${data.date} · 按本地日期累计`;
    document.querySelector("#sites").replaceChildren(...C.SITES.map(s => row(s.label, data.today[s.id] || 0, true)));
    document.querySelector("#history").replaceChildren(...(data.history.length ? data.history : [{date: data.date, ms: 0}]).map(d => row(d.date, d.ms)));
  } catch { document.querySelector("#status").textContent = "读取失败，请重新打开插件"; }
}
void refresh();
setInterval(refresh, 2000);
