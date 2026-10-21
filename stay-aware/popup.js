const statistics = AwareStats.create(document.querySelector("main"));
async function refresh() {
  try {
    const data = await chrome.runtime.sendMessage({type: "DASHBOARD"});
    if (!data?.ok) throw new Error();
    statistics.update(data);
  } catch { statistics.status("读取失败，请重新打开插件"); }
}
void refresh();
setInterval(refresh, 2000);
