import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

process.env.VERCEL = "1";
process.env.OCR_ENGINE = "rapidocr";
const { default: app, extractUploadedFile } = await import("../server.mjs");
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const output = fileURLToPath(new URL("../.runtime/ocr-fix-2026-09-05/", import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1536, height: 960 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const saves = [];
let task;
let source;
const checks = [];

// Keep all browser edits in memory; never modify the user's saved reading tasks.
await page.route("**/api/**", async (route) => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  if (pathname.endsWith("/source")) return route.fulfill({ path: source, contentType: "application/pdf" });
  let body;
  if (pathname === "/api/auth/status") body = { authenticated: true };
  else if (pathname === "/api/health") body = { online: false, provider: "codex", storage: "local" };
  else if (pathname.endsWith("/highlights")) {
    const update = request.postDataJSON();
    saves.push(update);
    for (const item of update.updates || [update]) task.paragraphs.find((p) => p.id === item.paragraphId).highlights[item.side] = item.highlights;
    body = update.updates ? { updates: update.updates } : { highlights: update.highlights };
  } else if (pathname === "/api/tasks") body = { tasks: [task] };
  else body = { task };
  return route.fulfill({ json: body });
});

async function openTask(pageNumber = 1) {
  await page.goto("about:blank");
  await page.goto(`${base}/#/read/${task.id}`);
  await waitPage(pageNumber);
}
async function waitPage(number = 1) {
  const shell = page.locator(`.pdf-page-shell[data-page-number="${number}"]`);
  await shell.waitFor();
  await shell.scrollIntoViewIfNeeded();
  await page.waitForFunction((n) => document.querySelector(`.pdf-page-shell[data-page-number="${n}"]`)?.dataset.rendered === "true", number);
}
async function selectText(paragraph, start, end, endParagraph = paragraph) {
  await page.evaluate(({ paragraph, start, end, endParagraph }) => {
    function point(p, at) {
      const segment = p.sourceSegments.find((s) => s.start <= at && s.end >= at);
      const span = document.querySelector(`.pdf-page-shell[data-page-number="${p.pageNumber}"] [data-source-index="${segment.sourceIndex}"]`);
      const expected = p.original.slice(segment.start, segment.end);
      let offset = span.textContent.indexOf(expected) + at - segment.start;
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (offset <= walker.currentNode.length) return { node: walker.currentNode, offset, span };
        offset -= walker.currentNode.length;
      }
      throw new Error("Cannot locate selection endpoint");
    }
    const a = point(paragraph, start), b = point(endParagraph, end);
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    a.span.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, { paragraph, start, end, endParagraph });
}
async function addHighlight() {
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/highlights")),
    page.getByRole("button", { name: "高亮", exact: true }).click(),
  ]);
}
async function fixture(type, number) {
  source = fileURLToPath(new URL(`./fixtures/selection-${type}.pdf`, import.meta.url));
  const extracted = await extractUploadedFile({ originalname: `selection-${type}.pdf`, mimetype: "application/pdf", buffer: await readFile(source) });
  task = {
    id: `00000000-0000-4000-8000-00000000000${number}`, title: `PDF selection ${type}`, sourceName: `${type}.pdf`, sourceType: "pdf", sourceAvailable: true,
    status: "ready", pageCount: extracted.pages, targetLength: 800, summary: null,
    paragraphs: extracted.layoutParagraphs.map((p) => ({ ...p, status: "done", translationVisible: true, translation: p.language === "zh" ? p.original : "测试译文" })),
  };
  await writeFile(`${output}/${type}-extracted.json`, JSON.stringify(extracted, null, 2));
  return extracted;
}

try {
  await fixture("native", 1);
  await openTask();
  const duplicates = task.paragraphs.filter((p) => p.original === "36%");
  assert.equal(duplicates.length, 2);
  await selectText(duplicates[1], 0, 3);
  await addHighlight();
  assert.equal(saves.at(-1).paragraphId, duplicates[1].id, "重复文字必须定位到实际选中的第二处");
  checks.push("native repeated text selects the correct occurrence");
  await waitPage();

  const wide = task.paragraphs.find((p) => p.original.startsWith("Wiiii"));
  async function assertNativeScale() {
    const geometry = await page.evaluate((p) => {
      const shell = document.querySelector('.pdf-page-shell');
      const segment = p.sourceSegments[0];
      const span = shell.querySelector(`[data-source-index="${segment.sourceIndex}"]`);
      return { expected: segment.rect.width * shell.clientWidth, actual: span.getBoundingClientRect().width };
    }, wide);
    assert.ok(Math.abs(geometry.actual - geometry.expected) < 1, `原生文字层宽度必须与 PDF 坐标一致：${JSON.stringify(geometry)}`);
  }
  await assertNativeScale();
  await selectText(wide, 0, 5);
  await addHighlight();
  await waitPage();
  const endpoint = await page.evaluate((p) => {
    const span = document.querySelector(`[data-source-index="${p.sourceSegments[0].sourceIndex}"]`);
    const range = document.createRange();
    range.setStart(span.firstChild, 15);
    range.setEnd(span.firstChild, 16);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width * 0.2, y: rect.top + rect.height / 2 };
  }, wide);
  const mark = page.locator(`.pdf-highlight-overlay[data-paragraph-id="${wide.id}"]`).first();
  await mark.hover();
  const handle = await mark.locator('.pdf-range-handle.end').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(endpoint.x, endpoint.y, { steps: 10 });
  await Promise.all([page.waitForResponse((r) => r.url().endsWith("/highlights")), page.mouse.up()]);
  assert.equal(saves.at(-1).highlights.at(-1).end, 15, "拖动边界必须按真实字宽定位");
  checks.push("actual mouse drag respects proportional glyph widths");

  await page.getByRole("button", { name: "放大 PDF" }).click();
  await waitPage();
  await assertNativeScale();
  checks.push("text layer matches original PDF width before and after zoom");
  await selectText(duplicates[1], 1, 2);
  await page.getByRole("button", { name: "解释", exact: true }).waitFor();
  const mapped = await page.evaluate(async ({ p }) => {
    const { selectionFromPdfRange } = await import('/pdf-selection.mjs');
    return selectionFromPdfRange([p], document.querySelector('.pdf-text-layer'), window.getSelection().getRangeAt(0));
  }, { p: duplicates[1] });
  assert.equal(mapped[0].start, 1);
  assert.equal(mapped[0].end, 2);
  checks.push("selection remains anchored after zoom");
  await page.screenshot({ path: `${output}/native-selection-after.png` });

  await openTask();
  const first = task.paragraphs.find((p) => p.original.startsWith("First finding"));
  const second = task.paragraphs.find((p) => p.original.startsWith("Second finding"));
  await selectText(first, 0, second.original.length, second);
  await addHighlight();
  assert.deepEqual(saves.at(-1).updates.map((u) => u.paragraphId), [first.id, second.id], "跨文字块划取应一次保存全部选中范围");
  checks.push("selection across source blocks saves both ranges");

  const scanned = await fixture("scanned", 2);
  assert.equal(scanned.recognitionPages[0].engine, "rapidocr");
  assert.match(scanned.text, /调查显示，75%的企业受到关税影响。/);
  assert.match(scanned.text, /Reading evidence should remain accurate\./);
  assert.ok(task.paragraphs.every((p) => p.sourceSegments.every((s) => s.ocr && s.glyphs.length)));
  await openTask();
  assert.equal(await page.locator('.ocr-text-layer').count(), 1, "无原生文字层的扫描页必须提供 OCR 选取层");
  const chinese = task.paragraphs.find((p) => p.original.includes("75%"));
  const start = chinese.original.indexOf("75%");
  await selectText(chinese, start, start + 3);
  await addHighlight();
  assert.equal(saves.at(-1).paragraphId, chinese.id);
  assert.equal(saves.at(-1).highlights.at(-1).start, start);
  assert.equal(saves.at(-1).highlights.at(-1).end, start + 3);
  await waitPage();
  assert.ok(await page.locator(`.pdf-highlight-overlay[data-paragraph-id="${chinese.id}"]`).count());
  await page.screenshot({ path: `${output}/scanned-selection-after.png` });
  checks.push("real local OCR recognizes bilingual image-only PDF and supports highlighting");
  await openTask();
  assert.ok(await page.locator(`.pdf-highlight-overlay[data-paragraph-id="${chinese.id}"]`).count());
  checks.push("saved scan highlight renders after reopening");

  // Also exercise the user's existing report when it is present locally.
  const userFixture = new URL('../data/c59d1753-3c40-48c2-89f2-98f317d43b70.json', import.meta.url);
  const userTask = await readFile(userFixture).then(JSON.parse).catch(() => null);
  if (userTask) {
    task = userTask;
    source = fileURLToPath(new URL(`../data/sources/${task.id}.pdf`, import.meta.url));
    await openTask(8);
    const repeated = task.paragraphs.filter((p) => p.pageNumber === 8 && p.original === "36%");
    await selectText(repeated[1], 0, 3);
    await addHighlight();
    assert.equal(saves.at(-1).paragraphId, repeated[1].id);
    checks.push("existing 40-page report: second 36% saves to p-128");
  }
  assert.deepEqual(errors, []);
  const result = { ok: true, checks, browserErrors: errors };
  await writeFile(`${output}/selection-tests.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  server.close();
}
