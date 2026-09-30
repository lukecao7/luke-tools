import assert from "node:assert/strict";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

process.env.VERCEL = "1";
const { default: app } = await import("../server.mjs");
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const output = fileURLToPath(new URL("../.runtime/model-config-2026-09-05/", import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1897, height: 1312 } });
const errors = [], checks = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/api/**", (route) => route.fulfill({ json: {
  authenticated: true, online: false, provider: "codex", tasks: [],
} }));

async function settle() {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function positions() {
  return page.evaluate(() => ["#pdf-scroll", "#pdf-translation-scroll"].map((id) => {
    const scroll = document.querySelector(id);
    const pages = [...scroll.querySelectorAll("[data-page-number]")];
    const line = scroll.getBoundingClientRect().top + Math.min(90, scroll.clientHeight / 4);
    const index = Math.max(0, pages.findLastIndex((p) => p.getBoundingClientRect().top <= line));
    const p = pages[index].getBoundingClientRect();
    const end = pages[index + 1]?.getBoundingClientRect().top ?? p.bottom;
    return { page: Number(pages[index].dataset.pageNumber), fraction: (line - p.top) / (end - p.top), top: scroll.scrollTop, max: scroll.scrollHeight - scroll.clientHeight };
  }));
}
async function checkAligned(label, expectedPage) {
  await settle();
  const [left, right] = await positions();
  assert.equal(left.page, right.page, `${label}: ${JSON.stringify({ left, right })}`);
  if (expectedPage) assert.equal(left.page, expectedPage, label);
  assert.ok(Math.abs(left.fraction - right.fraction) < .008, `${label}: page progress differs`);
  checks.push(label);
  return [left, right];
}
async function scrollToPage(side, number, fraction) {
  await page.evaluate(({ side, number, fraction }) => {
    const scroll = document.querySelector(side === "left" ? "#pdf-scroll" : "#pdf-translation-scroll");
    const p = scroll.querySelector(`[data-page-number="${number}"]`);
    const next = p.nextElementSibling;
    const top = p.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
    const height = next ? next.getBoundingClientRect().top - p.getBoundingClientRect().top : p.getBoundingClientRect().height;
    scroll.scrollTo({ top: top + fraction * height - 90, behavior: "instant" });
  }, { side, number, fraction });
  await settle();
}

try {
  // Deliberately unequal and changing heights, including a page with no text.
  await page.goto(base);
  await page.setContent(`<style>body{margin:0;display:flex;gap:20px}.pane{width:400px;height:500px;overflow:auto}section{width:600px;margin:0 0 20px;background:#eee}</style>
    <div class="pane" id="pdf-scroll">${[800, 1100, 500, 900, 1400, 760].map((h, i) => `<section class="pdf-page-shell" data-page-number="${i + 1}" style="height:${h}px">Original ${i + 1}</section>`).join("")}</div>
    <div class="pane" id="pdf-translation-scroll">${[500, 1800, 700, 1400, 2000, 1100].map((h, i) => `<section class="pdf-translation-page" data-page-number="${i + 1}" style="height:${h}px">${i === 2 ? "" : `Translation ${i + 1}`}</section>`).join("")}</div>`);
  await page.evaluate(async () => {
    const { createPdfScrollSync } = await import("/pdf-scroll-sync.mjs");
    window.sync = createPdfScrollSync({ original: document.querySelector("#pdf-scroll"), translation: document.querySelector("#pdf-translation-scroll"), view: "compare", onChange: () => {} });
  });
  await settle();
  await scrollToPage("right", 2, .35);
  await checkAligned("translation drives PDF at unequal page heights", 2);
  await page.locator("#pdf-translation-scroll").hover();
  await page.mouse.wheel(0, 350);
  await page.waitForFunction(() => document.querySelector("#pdf-translation-scroll").scrollTop > 1100);
  await checkAligned("real wheel movement continuously advances both panes", 2);
  await scrollToPage("left", 4, .45);
  await checkAligned("PDF drives translation across multiple pages", 4);
  await scrollToPage("right", 3, .7);
  await checkAligned("backward scrolling through an empty translation page", 3);
  await scrollToPage("left", 2, .25);
  await scrollToPage("right", 5, .4);
  await checkAligned("switching the driving pane does not create feedback", 5);
  const beforeResize = await positions();
  await page.evaluate(() => { document.querySelector("#pdf-translation-scroll [data-page-number='2']").style.height = "2300px"; });
  await checkAligned("translation reflow preserves the reading anchor", 5);
  assert.ok(Math.abs((await positions())[1].fraction - beforeResize[1].fraction) < .008);
  const beforeHorizontal = await positions();
  await page.evaluate(() => { document.querySelector("#pdf-scroll").scrollLeft = 100; });
  await settle();
  assert.deepEqual((await positions()).map((p) => p.top), beforeHorizontal.map((p) => p.top));
  checks.push("horizontal PDF panning does not change vertical position");
  for (const edge of ["end", "start"]) {
    await page.evaluate((edge) => { const right = document.querySelector("#pdf-translation-scroll"); right.scrollTop = edge === "end" ? right.scrollHeight : 0; }, edge);
    await settle();
    const snapshot = await positions();
    for (const p of snapshot) assert.ok(Math.abs(p.top - (edge === "end" ? p.max : 0)) < 1);
    await page.waitForTimeout(200);
    assert.deepEqual(await positions(), snapshot, "synced scroll must settle without bouncing");
    checks.push(`both panes stop at document ${edge} without bouncing`);
  }

  // Exercise the actual reader with a local report when available, read-only.
  const data = new URL("../data/", import.meta.url);
  const tasks = await Promise.all((await readdir(data)).filter((file) => file.endsWith(".json")).map(async (file) => JSON.parse(await readFile(new URL(file, data)))));
  const task = tasks.filter((t) => t.sourceType === "pdf" && t.status === "ready" && t.pageCount >= 8).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (task) {
    await page.route("**/api/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      assert.equal(route.request().method(), "GET", "reader navigation must not mutate saved tasks");
      if (pathname.endsWith("/source")) return route.fulfill({ path: fileURLToPath(new URL(`sources/${task.id}.pdf`, data)), contentType: "application/pdf" });
      const body = pathname === "/api/auth/status" ? { authenticated: true } : pathname === "/api/health" ? { online: false, provider: "codex" } : pathname === "/api/tasks" ? { tasks: [task] } : { task };
      return route.fulfill({ json: body });
    });
    await page.goto("about:blank");
    await page.goto(`${base}/#/read/${task.id}`);
    await page.waitForSelector(".pdf-page-shell[data-rendered='true']");
    await scrollToPage("right", 4, .35);
    await checkAligned("actual report: translation and PDF both reach page 4", 4);
    await page.waitForSelector('.pdf-page-shell[data-page-number="4"][data-rendered="true"]');
    await page.screenshot({ path: `${output}/scroll-report-after.png` });
    await page.getByRole("button", { name: "放大 PDF", exact: true }).click();
    await page.waitForSelector('.pdf-page-shell[data-page-number="4"][data-rendered="true"]');
    const zoomed = await checkAligned("actual report: zoom preserves page and within-page progress", 4);
    assert.ok(Math.abs(zoomed[0].fraction - .35) < .008);
    await page.getByRole("button", { name: "译文", exact: true }).click();
    await page.waitForFunction((count) => document.querySelector("#footer-position")?.textContent === `4 / ${count} 页`, task.pageCount);
    await scrollToPage("right", 8, .3);
    await page.getByRole("button", { name: "对照", exact: true }).click();
    await page.waitForSelector('.pdf-page-shell[data-page-number="8"][data-rendered="true"]');
    await checkAligned("actual report: returning from translation-only keeps the reading location", 8);
    await page.getByRole("button", { name: "查看重点", exact: true }).click();
    await page.locator("#close-drawer").click();
    await page.waitForSelector('.pdf-page-shell[data-page-number="8"][data-rendered="true"]');
    await checkAligned("actual report: opening and closing highlights keeps the reading location", 8);
    const toc = page.locator('.toc-item[data-page="5"]').first();
    if (await toc.count()) {
      await toc.click();
      await checkAligned("actual report: table of contents moves both panes together", 5);
    }
    await page.setViewportSize({ width: 1536, height: 960 });
    await checkAligned("actual report: resizing the window preserves alignment", 5);
    await page.evaluate(() => { location.hash = "#/"; });
    await page.locator("#new-task").waitFor();
    await settle();
    await page.evaluate((id) => { location.hash = `#/read/${id}`; }, task.id);
    await page.waitForSelector('.pdf-page-shell[data-page-number="5"][data-rendered="true"]');
    await checkAligned("actual report: leaving and returning cleans up scroll listeners", 5);
  }
  assert.deepEqual(errors, []);
  const result = { ok: true, checks, browserErrors: errors };
  await writeFile(`${output}/scroll-tests.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  server.close();
}
