import assert from 'node:assert/strict';
const space = 'a'.repeat(64), values = new Map([['longform.reading.space.v1', space], ['longform.deepseek.key.v1', 'retired-key']]);
const requests = [];
globalThis.location = { href: 'https://reading.example/', origin: 'https://reading.example' };
globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
globalThis.fetch = async (url, options = {}) => { requests.push({ url: String(url), headers: new Headers(options.headers) }); return new Response('{}'); };
const { configureReadingSpace, apiFetch } = await import('../public/reading-space.mjs');
configureReadingSpace({ browserSpaces: true });
assert.equal(values.get('longform.reading.space.v1'), space, 'Keep access to existing articles');
assert.equal(values.has('longform.deepseek.key.v1'), false, 'Retire the unused credential');
await apiFetch('/api/tasks/test/summary', { method: 'POST' });
await apiFetch('/api/tasks/test/highlights', { method: 'PATCH' });
await apiFetch('/api/tasks/test');
await apiFetch('https://elsewhere.example/api/tasks/test', { method: 'POST' });
assert.equal(requests.length, 4, 'No balance checks or other account requests');
for (const request of requests) {
  assert.equal(request.headers.has('X-DeepSeek-Key'), false);
  assert.equal(request.headers.has('Authorization'), false);
  assert.equal(request.headers.get('X-Reading-Space'), request.url.startsWith('/') ? space : null);
}
console.log(JSON.stringify({ ok: true, checks: ['existing reading space retained', 'old key removed', 'no billing requests', 'no credential forwarding', 'cross-origin capability isolation'] }));
