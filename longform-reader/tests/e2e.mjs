import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--disable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 1536, height: 960 }, deviceScaleFactor: 1 });
const errors = [];
const step = (name) => console.log(`[e2e] ${name}`);
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:4173";
let createdTaskId = null;
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("pageerror", (error) => errors.push(error.message));

try {
  step("打开首页");
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  if (process.env.APP_PASSWORD && await page.locator("#login-form").count()) {
    step("通过访问密码登录");
    await page.locator("#login-password").fill(process.env.APP_PASSWORD);
    await page.getByRole("button", { name: "进入" }).click();
    await page.getByRole("button", { name: "新建阅读" }).waitFor();
  }
  if (process.env.TASK_ID) {
    step("复用已处理的验收材料");
    createdTaskId = process.env.TASK_ID;
    await page.goto(`${baseUrl}/#/read/${process.env.TASK_ID}`, { waitUntil: "networkidle" });
  } else {
    step("从独立导入页粘贴材料");
    await page.getByRole("button", { name: "新建阅读" }).click();
    await page.getByRole("button", { name: "粘贴文字" }).click();
    await page.locator("#doc-title").fill("数字政府服务改革指南");
    await page.locator("#paste-text").fill(`1. Policy goals

Digital government reform should create public services that are accessible, transparent, and accountable. The central objective is to improve public value and public trust rather than simply move existing forms online.

2. Implementation path

A phased approach begins with high-impact and feasible services. Early projects should solve real user needs, publish measurable outcomes, and build institutional support for later reforms.

Implementation capacity depends on people, budgets, shared standards, secure data exchange, and clear responsibility across agencies. Each programme should have an accountable owner and a review timetable.

3. Risks and safeguards

Governments must protect privacy, provide offline alternatives, and avoid excluding people with limited digital access. Independent evaluation and public feedback should inform policy adjustments.`);
    await page.locator("#privacy-check").check();
    await page.getByRole("button", { name: "开始阅读" }).click();
    await page.waitForURL(/#\/read\//, { timeout: 240_000 });
    createdTaskId = page.url().split("/").at(-1);
  }
  step("等待翻译和高亮完成");
  await page.getByRole("button", { name: "生成摘要" }).waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#generate-summary")?.disabled, null, { timeout: 240_000 });

  step("检查阅读页结构");
  assert.equal(await page.getByText("导入内容", { exact: true }).count(), 0, "阅读页不应显示导入内容");
  const order = await page.locator(".header-actions").evaluate((node) => [...node.children].map((child) => child.textContent.trim() || child.id));
  assert.deepEqual(order.slice(-2), ["查看重点", "生成摘要"]);
  const aligned = await page.locator(".paragraph-row:not(.heading-row)").first().evaluate((row) => {
    const cells = row.querySelectorAll(".paragraph-cell");
    return Math.abs(cells[0].getBoundingClientRect().top - cells[1].getBoundingClientRect().top) < 1;
  });
  assert.equal(aligned, true, "左右段落顶部未对齐");
  assert.ok(await page.locator("mark.highlight").count() > 0, "没有生成重点高亮");
  await page.screenshot({ path: ".runtime/e2e-reader.png", fullPage: false });

  step("检查重点抽屉");
  await page.getByRole("button", { name: "查看重点" }).click();
  await page.getByText("仅展示原文、译文和必要的上下文，不生成摘要。").waitFor();
  assert.ok(await page.locator(".focus-section").count() > 0);
  await page.locator("#close-drawer").click();

  step("检查高亮点击菜单");
  await page.locator("mark.highlight").first().click();
  await page.getByRole("button", { name: "取消高亮" }).waitFor();
  step("调用解释");
  await page.getByRole("button", { name: "解释" }).evaluate((button) => button.click());
  await page.locator("#explain-answer").waitFor();
  await page.waitForFunction(() => !document.querySelector("#explain-card")?.textContent.includes("正在结合上下文解释"), null, { timeout: 180_000 });
  assert.ok((await page.locator("#explain-answer").innerText()).length > 5);
  console.log("[e2e] 解释卡位置", await page.locator("#explain-card").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight };
  }));
  await page.screenshot({ path: ".runtime/e2e-explain.png", fullPage: false });
  await page.locator("#close-explain").evaluate((button) => button.click());

  step("检查鼠标划取并新增高亮");
  await page.locator(".paragraph-row:not(.heading-row) .original-cell .paragraph-text").first().evaluate((container) => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node = null;
    while (walker.nextNode()) {
      const candidate = walker.currentNode;
      if (candidate.data.trim().length >= 8) { node = candidate; break; }
    }
    if (!node) throw new Error("没有找到可供划取的普通文字");
    const leading = node.data.search(/\S/);
    const range = document.createRange();
    range.setStart(node, Math.max(0, leading));
    range.setEnd(node, Math.min(node.data.length, Math.max(0, leading) + 8));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 720, clientY: 260 }));
  });
  await page.getByRole("button", { name: "高亮", exact: true }).waitFor();
  await page.getByRole("button", { name: "高亮", exact: true }).click();

  step("生成 300 字摘要");
  await page.locator("#target-length").fill("300");
  await page.getByRole("button", { name: "生成摘要" }).click();
  await page.waitForURL(/#\/summary\//);
  await page.locator("#summary-content").waitFor({ state: "visible", timeout: 240_000 });
  assert.ok((await page.locator("#summary-content").inputValue()).length > 50);
  await page.screenshot({ path: ".runtime/e2e-summary.png", fullPage: false });

  step("完成");
  assert.deepEqual(errors, [], `浏览器错误：${errors.join(" | ")}`);
  console.log(JSON.stringify({ ok: true, url: page.url(), browserErrors: errors.length }));
} finally {
  if (process.env.CLEANUP === "1" && createdTaskId) {
    await page.request.delete(`${baseUrl}/api/tasks/${createdTaskId}`).catch(() => {});
  }
  await browser.close();
}
