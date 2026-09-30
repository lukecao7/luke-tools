import assert from 'node:assert/strict';
import { translationUnit, sourceRangesForTranslation, createHighlightOutbox } from '../public/highlight-edits.mjs';
const task = { id: 'report', paragraphs: [
  { id: 'p1', original: 'a'.repeat(100), translation: '文'.repeat(50), translationAlignment: [
    { sourceParagraphId: 'p1', sourceStart: 0, sourceEnd: 80, start: 0, end: 40 },
    { sourceParagraphId: 'p1', sourceStart: 80, sourceEnd: 100, start: 40, end: 50 },
    { sourceParagraphId: 'p2', sourceStart: 0, sourceEnd: 20, start: 40, end: 50 },
  ], highlights: { original: [], translation: [] } },
  { id: 'p2', original: 'b'.repeat(100), highlights: { original: [], translation: [] } },
], figures: [{ labels: [{ id: 'label', original: 'Cross-border restrictions', translation: '跨境限制', sources: [{ paragraphId: 'p1', start: 10, end: 30 }] }] }] };
assert.deepEqual(sourceRangesForTranslation(translationUnit(task, { paragraphId: 'p1' }), 10, 20), [{ paragraphId: 'p1', start: 20, end: 40 }]);
assert.deepEqual(sourceRangesForTranslation(translationUnit(task, { paragraphId: 'p1' }), 40, 50), [{ paragraphId: 'p1', start: 80, end: 100 }, { paragraphId: 'p2', start: 0, end: 20 }], 'A continued sentence edits both source pages');
assert.deepEqual(sourceRangesForTranslation(translationUnit(task, { labelId: 'label' }), 0, 2), [{ paragraphId: 'p1', start: 10, end: 20 }]);
const quote = { id: 'quote', original: 'a'.repeat(20), translation: '引文'.repeat(5), pullQuote: true };
assert.deepEqual(sourceRangesForTranslation(translationUnit(task, { paragraphId: 'quote' }, [quote]), 0, 5), [{ paragraphId: 'quote', start: 0, end: 10 }], 'Repeated pull quotes retain their own location');

let disk = '{}'; const storage = { getItem: () => disk, setItem: (_, value) => { disk = value; } };
const requests = [], statuses = [];
let release;
const outbox = createHighlightOutbox({ storage, onStatus: (_, s) => statuses.push(s), send: async (_, updates) => {
  requests.push(updates); await new Promise(resolve => { release = resolve; });
} });
const update = highlights => ({ paragraphId: 'p1', side: 'original', highlights });
const a = [{ id: 'a', start: 1, end: 10, kind: 'user' }];
outbox.enqueue('report', [update(a)]);
outbox.enqueue('report', [update([])]);
outbox.enqueue('report', [update([{ ...a[0], end: 20 }])]);
const copy = structuredClone(task); outbox.apply(copy);
assert.equal(copy.paragraphs[0].highlights.original[0].end, 20, 'Latest pending edit is immediately restored');
release(); await new Promise(resolve => setImmediate(resolve));
assert.equal(requests.length, 2, 'Intermediate edits are coalesced');
assert.equal(requests[1][0].highlights[0].end, 20, 'Slow first response cannot replace the last edit');
release(); await outbox.flush('report');
assert.equal(outbox.hasPending('report'), false);
let failing = true;
const failed = createHighlightOutbox({ storage, send: async () => { if (failing) throw new Error('offline'); } });
failed.enqueue('report', [update([])]); assert.equal(await failed.flush('report'), false);
assert.ok(failed.hasPending('report'));
const restored = createHighlightOutbox({ storage, send: async () => {} });
const reloaded = structuredClone(task); reloaded.paragraphs[0].highlights.original = a; restored.apply(reloaded);
assert.deepEqual(reloaded.paragraphs[0].highlights.original, [], 'An offline deletion survives reload');
await restored.flush('report'); assert.equal(restored.hasPending('report'), false);
console.log('PASS: bidirectional body/chart/quote mapping; serial/coalesced writes; offline deletion recovery');
