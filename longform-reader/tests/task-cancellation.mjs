import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, symlink, writeFile, readFile, chmod, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createPdfOcrWorker } from "../ocr/engine.mjs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { processingCounts, processingDetails } from "../public/processing-progress.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), "task-cancellation-"));
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

  for (const file of ["server.mjs", "reading-space.mjs", "task-updates.mjs", "package.json"]) await copyFile(path.join(root, file), path.join(directory, file));
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
fs.writeFileSync(path.join(dir, phase + '.started'), JSON.stringify({pid:process.pid,ids:items.map(p=>p.id)}));
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
  server = spawn(process.execPath, ["server.mjs"], { cwd: directory, env: { ...process.env,CODEX_BIN:"codex",READING_SPACES:"0", VERCEL: "0", STORAGE_PROVIDER: "local", AI_PROVIDER: "codex", APP_PASSWORD: "", PORT: String(port), TEST_GATE: directory, PATH: `${path.join(directory, "bin")}:${process.env.PATH}` }, stdio: "ignore" });
  await until(async () => { try { return (await fetch(url + "/api/tasks")).ok; } catch { return false; } });
  if (serve) {
    console.log(JSON.stringify({ url, directory, sample: path.join(directory, "sample.txt") }));
    await new Promise(resolve => { process.once("SIGTERM", resolve); process.once("SIGINT", resolve); });
  } else {
    const get = async id => (await (await fetch(url + `/api/tasks/${id}`)).json()).task;
    const cancel = async id => {
      const response = await fetch(url + `/api/tasks/${id}/cancel`, {method:"POST"});
      assert.equal(response.status, 200); return response.json();
    };
    const exists = async name => { try { await readFile(path.join(directory, name)); return true; } catch { return false; } };
    const started = async phase => JSON.parse(await readFile(path.join(directory, phase + ".started"), "utf8"));
    const gone = pid => { try { process.kill(pid,0); return false; } catch(e) { return e.code === "ESRCH"; } };
    const submit = async text => {
      const id = randomUUID(), form = new FormData(); form.set("title", "Cancellation fixture"); form.set("text", text);
      const response = await fetch(url + "/api/tasks", {method:"POST",headers:{"X-Task-Id":id},body:form});
      assert.equal(response.status, 202); return id;
    };
    const id = await submit(sample);
    await until(() => exists("analysis.started"));
    const analysisPid = (await started("analysis")).pid;
    assert.equal((await cancel(id)).task.status, "cancelled");
    assert.ok(gone(analysisPid), "Cancel must stop the underlying Codex process before acknowledging");
    assert.equal((await cancel(id)).task.status, "cancelled", "Cancellation is idempotent");
    assert.ok(!await exists("translation-1.started"), "No translation may start after cancellation");
    await fetch(url + `/api/tasks/${id}/retry`, {method:"POST"});
    await writeFile(path.join(directory,"analysis.release"), "release");
    await until(() => exists("translation-1.started"));
    await writeFile(path.join(directory,"translation-1.release"), "release");
    await until(() => exists("translation-2.started"));
    const partial = await get(id);
    assert.equal(partial.translatedParagraphs,80);
    const batchPid = (await started("translation-2")).pid;
    const cancelled = (await cancel(id)).task;
    assert.equal(cancelled.status,"cancelled"); assert.equal(cancelled.translatedParagraphs,80);
    assert.ok(gone(batchPid));
    const analysisAfterResume = (await started("analysis")).pid;
    await writeFile(path.join(directory,"translation-2.release"),"release");
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal((await get(id)).status,"cancelled", "Late provider results cannot restore a cancelled task");
    await fetch(url + `/api/tasks/${id}/retry`,{method:"POST"});
    await until(()=>exists("translation-3.started"));
    assert.equal((await started("translation-3")).ids.length,1, "Only the incomplete item is resent");
    assert.equal((await started("analysis")).pid,analysisAfterResume, "Completed analysis is not repeated");
    await writeFile(path.join(directory,"translation-3.release"),"release");
    await until(async()=> (await get(id)).status === "ready");
    assert.equal((await cancel(id)).task.status,"ready", "A completed task is never downgraded");
    assert.equal((await get(id)).translatedParagraphs,81);
    assert.deepEqual((await get(id)).paragraphs.slice(0,80).map(p=>p.translation), partial.paragraphs.slice(0,80).map(p=>p.translation));
    const empty = await cancel(randomUUID()); assert.equal(empty.task,null);

    // Exercise the streaming path used by the browser too.
    await rm(path.join(directory,"analysis.release")); await rm(path.join(directory,"analysis.started"));
    const streamId = randomUUID(), form = new FormData(); form.set("text",sample);
    const response = await fetch(url + "/api/tasks",{method:"POST",headers:{Accept:"application/x-ndjson","X-Task-Id":streamId},body:form});
    const result = response.text();
    await until(()=>exists("analysis.started"));
    assert.equal((await cancel(streamId)).task.status,"cancelled");
    assert.match(await result,/"type":"cancelled"/);

    // RapidOCR is a separate worker; cancellation must stop it as well.
    const fakeOcr = path.join(directory,"bin","fake-ocr");
    await writeFile(fakeOcr, `#!${process.execPath}\nimport fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(path.join(directory,"ocr.pid"))},String(process.pid)); console.log(JSON.stringify({type:'ready'})); process.stdin.resume();`);
    await chmod(fakeOcr,0o755);
    process.env.OCR_ENGINE="rapidocr"; process.env.OCR_PYTHON=fakeOcr;
    const controller = new AbortController();
    const worker = await createPdfOcrWorker({signal:controller.signal});
    const recognition = worker.recognize(Buffer.from("synthetic fixture"));
    controller.abort();
    await assert.rejects(recognition,{name:"AbortError"});
    await worker.terminate();
    const ocrPid = Number(await readFile(path.join(directory,"ocr.pid"),"utf8"));
    await until(()=>gone(ocrPid));
    console.log(JSON.stringify({ok:true,checks:["analysis cancellation stops Codex", "streaming import cancellation", "partial translation saved", "resume sends only 1 remaining item of 81", "no repeated analysis", "late results cannot revive cancellation", "idempotent cancel", "completion race preserves ready", "OCR worker cancelled"]}));

  }
} finally {
  if (server) { server.kill(); await new Promise(resolve => server.once("exit", resolve)); }
  await rm(directory, { recursive: true, force: true });
}
