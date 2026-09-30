import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, symlink, writeFile, readFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { processingCounts, processingDetails } from "../public/processing-progress.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), "processing-progress-"));
const serve = process.argv.includes("--serve");
const sample = Array.from({ length: 81 }, (_, i) => `Reading note ${i + 1}: This paragraph explains how a reader can understand a document and keep track of its main ideas. It is synthetic text for checking the progress display.`).join("\n\n");
let server;
async function until(check) {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Progress did not reach the expected stage");
}
try {
  const uploadStarted = new Date(Date.now() - 12000).toISOString();
  for (const processingStage of ['recognition','analysis','translation']) {
    const details = processingDetails({processingStage,processingStartedAt:uploadStarted,stageStartedAt:new Date().toISOString()});
    assert.equal(details.startedAt,uploadStarted,'Changing stages cannot reset elapsed time');
    assert.equal(details.timeLabel,'累计已用');
  }
  const recognized = processingDetails({ processingStage: "recognition", currentPage: 7, pageCount: 40 });
  assert.equal(recognized.value, "已识别 7/40 页");
  assert.equal(recognized.ratio, 7 / 40);
  assert.equal(recognized.stageIndex, 0);
  const analysis = processingDetails({ processingStage: "analysis", progressPercent: 28, recognizedPages: 40, pageCount: 40 });
  assert.equal(analysis.ratio, null);
  assert.equal(analysis.value, "");
  assert.match(analysis.detail, /已识别 40\/40 页/);
  assert.equal(processingDetails({ processingStage: "analysis", analysisStep: "charts" }).title, "正在核对图表重点");
  assert.equal(processingDetails({ processingStage: "translation", processedParagraphs: 900, paragraphCount: 1001 }).ratio, null);
  const counts = processingCounts({ paragraphs: [{ translationVisible: false, status: "done" }, { translationVisible: true, status: "done" }, { translationVisible: true, status: "pending" }] });
  assert.equal(counts.translatedParagraphs, 1);
  assert.equal(counts.totalTranslationParagraphs, 2);
  const resumed = processingCounts({ realignExisting: true, paragraphs: [
    { translationVisible: true, status: "done", translationAligned: false },
    { translationVisible: true, status: "done", translationContinuationOf: "head" },
    { translationVisible: true, status: "done", translationAligned: true },
  ] });
  assert.equal(resumed.totalTranslationParagraphs, 2);
  assert.equal(resumed.translatedParagraphs, 1, "Repaired paragraphs count only after alignment is complete");

  for (const file of ["server.mjs", "deepseek-access.mjs", "task-updates.mjs", "package.json"]) await copyFile(path.join(root, file), path.join(directory, file));
  for (const name of ["node_modules", "ocr", "schemas", "public"]) await symlink(path.join(root, name), path.join(directory, name));
  await mkdir(path.join(directory, "bin"));
  await writeFile(path.join(directory, "sample.txt"), sample);
  const mock = path.join(directory, "bin", "codex");
  await writeFile(mock, `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
if (process.argv.includes('--version')) { console.log('progress-test'); process.exit(0); }
const output = process.argv[process.argv.indexOf('-o') + 1];
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const isAnalysis = prompt.includes('SOURCE_BLOCKS:');
const items = JSON.parse(prompt.split(isAnalysis ? 'SOURCE_BLOCKS:' : 'SOURCE_ITEMS:').at(-1).trim());
const dir = process.env.TEST_GATE;
let phase = 'analysis';
if (!isAnalysis) {
  const counter = path.join(dir, 'translation-count');
  const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) + 1 : 1;
  fs.writeFileSync(counter, String(n));
  phase = 'translation-' + n;
}
fs.writeFileSync(path.join(dir, phase + '.started'), 'started');
const timer = setInterval(() => {
  if (!fs.existsSync(path.join(dir, phase + '.release'))) return;
  clearInterval(timer);
  const result = isAnalysis ? {body_ids:items.map(p => p.id),highlights:[]} : {results:items.map(p=>({id:p.id,translation:'这段文字用于检查处理进度。' + p.id}))};
  fs.writeFileSync(output, JSON.stringify(result));
}, 30);
`);
  await chmod(mock, 0o755);
  const listener = createServer().listen(0, "127.0.0.1");
  await new Promise(resolve => listener.once("listening", resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["server.mjs"], { cwd: directory, env: { ...process.env, VERCEL: "0", STORAGE_PROVIDER: "local", AI_PROVIDER: "codex", APP_PASSWORD: "", PORT: String(port), TEST_GATE: directory, PATH: `${path.join(directory, "bin")}:${process.env.PATH}` }, stdio: "ignore" });
  await until(async () => { try { return (await fetch(url + "/api/tasks")).ok; } catch { return false; } });
  if (serve) {
    console.log(JSON.stringify({ url, directory, sample: path.join(directory, "sample.txt") }));
    await new Promise(resolve => { process.once("SIGTERM", resolve); process.once("SIGINT", resolve); });
  } else {
    const form = new FormData(); form.set("title", "Progress test"); form.set("text", sample);
    const response = await fetch(url + "/api/tasks", { method: "POST", headers: { Accept: "application/x-ndjson", 'X-Processing-Started-At':uploadStarted }, body: form });
    const events = [];
    const consuming = (async () => {
      let buffer = "";
      for await (const chunk of response.body) {
        buffer += new TextDecoder().decode(chunk);
        const lines = buffer.split("\n"); buffer = lines.pop();
        lines.filter(Boolean).forEach(line => events.push(JSON.parse(line)));
      }
    })();
    const progressEvents = () => events.filter(event => event.type === "progress").map(event => event.progress);
    await until(() => progressEvents().some(p => p.processingStage === "analysis"));
    const id = events.find(e => e.type === "created").task.id;
    const opened = (await (await fetch(url + `/api/tasks/${id}`)).json()).task;
    assert.equal(processingDetails(opened).title, "正在分析全文");
    assert.equal(processingDetails(opened).startedAt,uploadStarted);
    const analysisStarted = opened.stageStartedAt;
    await writeFile(path.join(directory, "analysis.release"), "release");
    await until(() => progressEvents().some(p => p.processingStage === "translation"));
    const first = progressEvents().find(p => p.processingStage === "translation");
    assert.equal(first.translatedParagraphs, 0);
    assert.equal(first.totalTranslationParagraphs, 81);
    assert.notEqual(first.stageStartedAt, analysisStarted);
    assert.equal(processingDetails(first).startedAt,uploadStarted);
    await writeFile(path.join(directory, "translation-1.release"), "release");
    await until(() => progressEvents().some(p => p.translatedParagraphs === 80));
    const partial = progressEvents().find(p => p.translatedParagraphs === 80);
    assert.equal(partial.stageStartedAt, first.stageStartedAt);
    const listed = (await (await fetch(url + "/api/tasks")).json()).tasks[0];
    assert.equal(processingDetails(listed).compact, "已翻译 80/81 段");
    assert.equal(listed.stageStartedAt, first.stageStartedAt);
    assert.equal(processingDetails(listed).startedAt,uploadStarted,'Reloaded tasks retain the upload start time');
    await writeFile(path.join(directory, "translation-2.release"), "release");
    await consuming;
    const done = events.find(e => e.type === "done").task;
    assert.equal(done.translatedParagraphs, 81);
    assert.equal(done.status, "ready");
    assert.equal(processingDetails(done).startedAt,uploadStarted);
    console.log(JSON.stringify({ ok: true, checks: ["real page counts", "analysis has no artificial percentage", "chart analysis state", "exclude chart/furniture from translation count", "unknown totals stay indeterminate", "stream reports 0 then 80 then 81 translated paragraphs", "total timer survives upload, stages, batches and reload", "list includes actual counts", "completion opens ready task"] }));
  }
} finally {
  if (server) { server.kill(); await new Promise(resolve => server.once("exit", resolve)); }
  await rm(directory, { recursive: true, force: true });
}
