import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, symlink, writeFile, readFile, access, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { createTaskUpdater } from "../task-updates.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), "reading-update-test-"));
let server;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await sleep(40);
  }
  throw new Error("Test operation did not complete");
}
try {
  // Simulate a cloud conflict: a concurrent writer adds a highlight after read.
  let stored = { id: "test", highlights: [], summary: null, version: 1 };
  let conflict = true;
  const update = createTaskUpdater({
    read: async () => structuredClone(stored),
    write: async task => {
      if (conflict) { conflict = false; stored.highlights.push("new"); stored.version++; }
      if (task.version !== stored.version) throw new Error("conflict");
      stored = task;
    },
    isConflict: error => error.message === "conflict",
  });
  await update("test", task => { task.summary = "generated"; });
  assert.deepEqual(stored.highlights, ["new"]);
  assert.equal(stored.summary, "generated");

  for (const file of ["server.mjs", "reading-space.mjs", "task-updates.mjs", "package.json"]) await copyFile(path.join(root, file), path.join(directory, file));
  for (const name of ["node_modules", "ocr", "schemas", "public"]) await symlink(path.join(root, name), path.join(directory, name));
  await mkdir(path.join(directory, "bin"));
  await mkdir(path.join(directory, "data"));
  // Gate a fake model at its completion boundary; this test never calls AI.
  const mock = path.join(directory, "bin", "codex");
  await writeFile(mock, `#!${process.execPath}
import fs from 'node:fs';
if(process.argv.includes('--version')) { console.log('test'); process.exit(0); }
const output = process.argv[process.argv.indexOf('-o') + 1];
const gate = process.env.TEST_GATE;
process.stdin.resume();
fs.writeFileSync(gate + '.started', 'started');
const timer = setInterval(() => {
  if (!fs.existsSync(gate + '.release')) return;
  clearInterval(timer);
  fs.writeFileSync(output, JSON.stringify({title:'Test',summary:'Only the original evidence.'}));
}, 20);
`);
  await chmod(mock, 0o755);
  const id = "00000000-0000-4000-8000-000000000123";
  const paragraphs = [0, 1, 2].map(index => ({ id: `p-${index}`, index, original: "Original evidence for summary.", translation: "摘要证据", highlights: { original: index ? [] : [{ id: "a", start: 0, end: 8, kind: "user" }], translation: [] } }));
  await writeFile(path.join(directory, "data", `${id}.json`), JSON.stringify({ id, title: "Test", status: "ready", targetLength: 800, paragraphs }));
  const listener = createServer().listen(0, "127.0.0.1");
  await new Promise(resolve => listener.once("listening", resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const gate = path.join(directory, "model");
  server = spawn(process.execPath, ["server.mjs"], { cwd: directory, env: { ...process.env,CODEX_BIN:"codex",READING_SPACES:"0", VERCEL: "0", STORAGE_PROVIDER: "local", AI_PROVIDER: "codex", APP_PASSWORD: "", PORT: String(port), TEST_GATE: gate, PATH: `${path.join(directory, "bin")}:${process.env.PATH}` }, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}/api/tasks/${id}`;
  await until(async () => { try { return (await fetch(base)).ok; } catch { return false; } });
  const request = (suffix, method, body) => fetch(base + suffix, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await request("/summary", "POST", { targetLength: 0 })).status, 400);
  const generation = request("/summary", "POST", { targetLength: 800 });
  await until(() => access(gate + ".started").then(() => true, () => false));
  const changes = await Promise.all([1, 2].map(index => request("/highlights", "PATCH", { paragraphId: `p-${index}`, side: "original", highlights: [{ id: `new-${index}`, start: 9, end: 17, kind: "user" }] })));
  assert(changes.every(response => response.ok));
  const progress = { kind: "text", position: { paragraphId: "p-1", fraction: .4 }, view: "translation", scale: 1, updatedAt: new Date().toISOString() };
  assert.equal((await request("/reading-progress", "PATCH", progress)).status, 200);
  await writeFile(gate + ".release", "release");
  const response = await generation;
  assert.equal(response.status, 200);
  const task = (await (await fetch(base)).json()).task;
  assert.equal(task.paragraphs[1].highlights.original[0].id, "new-1");
  assert.equal(task.paragraphs[2].highlights.original[0].id, "new-2");
  assert.equal(task.summary.stale, true);
  assert.equal(task.readingProgress.position.paragraphId, "p-1");
  assert.equal(task.readingProgress.position.fraction, .4);
  assert.equal(task.readingProgress.view, "translation");
  assert.equal((await request("/reading-progress", "PATCH", { ...progress, position: { paragraphId: "p-0", fraction: 0 }, updatedAt: new Date(Date.parse(progress.updatedAt) - 1000).toISOString() })).status, 200);
  assert.equal((await request("/reading-progress", "PATCH", { ...progress, position: { paragraphId: "missing", fraction: 0 } })).status, 400);
  // Invalid edits must not block later saves or partially apply a batch.
  assert.equal((await request("/highlights", "PATCH", { updates: [ { paragraphId: "p-1", side: "original", highlights: [] }, { paragraphId: "missing", side: "original", highlights: [] } ] })).status, 400);
  assert.equal((await request("/summary", "PATCH", { title: "Edited", content: "Saved draft" })).status, 200);
  const saved = JSON.parse(await readFile(path.join(directory, "data", `${id}.json`), "utf8"));
  assert.equal(saved.paragraphs[1].highlights.original[0].id, "new-1");
  assert.equal(saved.summary.content, "Saved draft");
  assert.equal(saved.summary.stale, true);
  assert.equal(saved.readingProgress.position.paragraphId, "p-1");
  const listed = (await (await fetch(`http://127.0.0.1:${port}/api/tasks`)).json()).tasks;
  assert.deepEqual(listed[0].readingProgress, saved.readingProgress);
  server.kill();
  await new Promise(resolve => server.once("exit", resolve));
  server = spawn(process.execPath, ["server.mjs"], { cwd: directory, env: { ...process.env,CODEX_BIN:"codex",READING_SPACES:"0", VERCEL: "0", STORAGE_PROVIDER: "local", APP_PASSWORD: "", PORT: String(port) }, stdio: "ignore" });
  await until(async () => { try { return (await fetch(base)).ok; } catch { return false; } });
  assert.deepEqual((await (await fetch(base)).json()).task.readingProgress, saved.readingProgress);
  console.log(JSON.stringify({ ok: true, checks: ["cloud conflict merge", "zero length rejected", "parallel highlight saves", "generation preserves newer highlights and reading progress", "changed evidence marks summary stale", "failed batch atomic", "queue recovers after invalid edit", "late progress cannot rewind", "invalid paragraph rejected", "list includes resume progress", "progress survives server restart"] }));
} finally {
  if (server) { server.kill(); await new Promise(resolve => server.once("exit", resolve)); }
  await rm(directory, { recursive: true, force: true });
}
