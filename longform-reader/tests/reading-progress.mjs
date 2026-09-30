import assert from "node:assert/strict";
import { createReadingProgressStore, normalizeReadingProgress } from "../public/reading-progress.mjs";

const task = { id: "pdf", status: "ready", sourceType: "pdf", sourceAvailable: true, pageCount: 40 };
const snapshot = { kind: "pdf", position: { pageNumber: 4, fraction: .42, alignment: { pageNumber: 4, original: .42, translation: .27 } }, view: "compare", scale: 1.24, pageWidth: 540 };
const cache = new Map();
const storage = { getItem: key => cache.get(key), setItem: (key, value) => cache.set(key, value) };
let remote, offline = false, release;
const send = async (_id, progress) => {
  if (offline) throw new Error("offline");
  if (release) await new Promise(resolve => { release = resolve; });
  if (!remote || progress.updatedAt > remote.updatedAt) remote = { ...progress, savedAt: new Date().toISOString() };
  return remote;
};
const store = createReadingProgressStore({ storage, send });
assert.equal(store.hydrate(task), null);
store.record(task, snapshot);
await store.flush();
assert.equal(remote.position.fraction, .42);
assert.equal(remote.position.alignment.translation, .27);
assert.equal(remote.scale, 1.24);
assert.equal(remote.percent, 9);
// No browser cache: the document alone restores view, zoom, and both panes.
const fresh = createReadingProgressStore({ storage: { getItem: () => null, setItem: () => {} }, send });
assert.deepEqual(fresh.hydrate({ ...task, readingProgress: remote }), remote);

offline = true;
store.record(task, { ...snapshot, position: { pageNumber: 9, fraction: .7 } });
await store.flush();
assert.equal(remote.position.pageNumber, 4);
const reopened = createReadingProgressStore({ storage, send });
assert.equal(reopened.hydrate({ ...task, readingProgress: remote }).position.pageNumber, 9);
offline = false;
await reopened.flush();
assert.equal(remote.position.pageNumber, 9);
await store.flush(); // A late old session cannot rewind the saved record.

// Save response arrives after the user has continued reading.
release = true;
store.record(task, { ...snapshot, position: { pageNumber: 12, fraction: .5 } });
const pending = store.flush();
store.record(task, { ...snapshot, position: { pageNumber: 13, fraction: .6 } });
const finish = release;
release = null;
finish();
await pending;
assert.equal(store.get(task.id).position.pageNumber, 13);
await store.flush();
assert.equal(remote.position.pageNumber, 13);

cache.set("reading:legacy", JSON.stringify({ position: { taskId: "legacy", pageNumber: 5, fraction: .6 }, view: "original", scale: 1.12, pageWidth: 600 }));
const legacy = createReadingProgressStore({ storage, send: async (_, progress) => progress });
assert.equal(legacy.hydrate({ ...task, id: "legacy" }).position.pageNumber, 5);
await legacy.flush();
cache.set("reading:broken", "broken");
assert.equal(legacy.hydrate({ ...task, id: "broken" }), null);
const denied = createReadingProgressStore({ storage: { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } }, send: async (_, progress) => progress });
assert.equal(denied.hydrate(task), null);
denied.record(task, snapshot);
await denied.flush();
assert.equal(denied.get(task.id).position.pageNumber, 4);

for (const position of [{ pageNumber: 41, fraction: .1 }, { pageNumber: 2, fraction: -1 }, { pageNumber: 2, fraction: .5, alignment: { pageNumber: 2, original: 0, translation: .5 } }]) {
  assert.throws(() => normalizeReadingProgress(task, { ...snapshot, position, updatedAt: new Date().toISOString() }));
}
const textTask = { id: "text", paragraphs: [{ id: "p1" }, { id: "p2" }, { id: "p3" }] };
const text = normalizeReadingProgress(textTask, { kind: "text", position: { paragraphId: "p2", fraction: .5 }, view: "translation", scale: 1, updatedAt: new Date().toISOString() });
assert.equal(text.position.paragraphIndex, 1);
assert.equal(text.percent, 50);
const isolated = createReadingProgressStore({ storage, send: async (_, progress) => progress });
isolated.record(task, snapshot);
isolated.record({ ...textTask, status: "ready" }, text);
await isolated.flush();
assert.equal(isolated.get("pdf").position.pageNumber, 4);
assert.equal(isolated.get("text").position.paragraphId, "p2");
console.log(JSON.stringify({ ok: true, checks: ["PDF page fraction and alignment", "server-only resume", "offline reload recovery", "in-flight response preserves new movement", "legacy bookmark migration", "malformed/denied browser storage", "position validation", "text paragraph anchor", "document isolation"] }));
