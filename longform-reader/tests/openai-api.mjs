import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, symlink, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dir = await mkdtemp(path.join(tmpdir(), 'reading-openai-api-'));
const spaceA = 'a'.repeat(64), spaceB = 'b'.repeat(64);
const key = 'synthetic-test-key', calls = [];
let server, mock, mode = 'ok', aborted = false;
const until = async check => {
  for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 30)); }
  throw Error('Timed out');
};
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  for (const name of ['server.mjs', 'reading-space.mjs', 'task-updates.mjs', 'package.json']) await copyFile(path.join(root, name), path.join(dir, name));
  for (const name of ['public', 'schemas', 'ocr', 'node_modules']) await symlink(path.join(root, name), path.join(dir, name));
  mock = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw), prompt = body.input[0].content;
    calls.push({ url: request.url, headers: request.headers, body });
    response.setHeader('Content-Type', 'application/json');
    if (mode === 'wait') { response.on('close', () => { aborted = true; }); return; }
    if (mode === 'quota') { response.writeHead(429); response.end(JSON.stringify({ error: { code: 'credit_balance_exhausted', message: 'No credits' } })); return; }
    if (mode === 'incomplete') { response.end(JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })); return; }
    let result;
    if (prompt.includes('SOURCE_BLOCKS:')) {
      const items = JSON.parse(prompt.split('SOURCE_BLOCKS:').at(-1));
      result = { body_ids: items.map(p => p.id), figures: [], highlights: [] };
    } else if (prompt.includes('SOURCE_ITEMS:')) {
      const items = JSON.parse(prompt.split('SOURCE_ITEMS:').at(-1));
      result = { translations: Object.fromEntries(items.map(p => [p.id, Object.fromEntries([...p.text.matchAll(/^\[(s\d+)\]/gm)].map(m => [m[1], '验证译文。']))])) };
    } else result = { title: '验证摘要', summary: prompt.includes('DOCUMENT_TITLE: "用户甲"') ? '用户甲摘要' : '用户乙摘要', answer: '验证解释。' };
    response.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: mode === 'refusal' ? [{ type: 'refusal', refusal: 'Synthetic refusal' }] : [{ type: 'output_text', text: mode === 'invalid' ? '{broken' : JSON.stringify(result) }] }] }));
  });
  await listen(mock);
  const mockBase = `http://127.0.0.1:${mock.address().port}/v1`;
  // Verify server-only .env.local loading, including double-click launches.
  await writeFile(path.join(dir, '.env.local'), `OPENAI_API_KEY=${key}\nOPENAI_MODEL=gpt-6.1-sol\nOPENAI_REASONING_EFFORT=medium\nOPENAI_BASE_URL=${mockBase}\n`);
  const probe = createPortProbe(); await listen(probe); const port = probe.address().port; await new Promise(r => probe.close(r));
  const url = `http://127.0.0.1:${port}`;
  const env = { ...process.env, READING_SPACES: '1', VERCEL: '0', STORAGE_PROVIDER: 'local', APP_PASSWORD: '', PORT: String(port), CODEX_BIN: '/never-invoke-codex' };
  for (const name of ['AI_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT']) delete env[name];
  const start = async extra => {
    server = spawn(process.execPath, ['server.mjs'], { cwd: dir, env: { ...env, ...extra }, stdio: 'ignore' });
    await until(() => fetch(url + '/api/health').then(r => r.ok, () => false));
  };
  const stop = async () => { const exited = new Promise(r => server.once('exit', r)); server.kill(); await exited; server = null; };
  await start();
  const request = (route, space = spaceA, method = 'GET', body) => fetch(url + route, { method, headers: { ...(space ? { 'X-Reading-Space': space } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const health = await (await fetch(url + '/api/health')).json();
  assert.equal(health.provider, 'openai'); assert.equal(health.model, 'gpt-6.1-sol'); assert.equal(health.available, true);
  assert.equal(health.reasoningEffort, 'medium'); assert.equal(health.serviceTier, 'default');
  assert.ok(!JSON.stringify(health).includes(key)); assert.equal(health.cliVersion, undefined);
  assert.equal(calls.length, 0, 'Health checks must not spend credits');
  assert.equal((await request('/api/tasks', null)).status, 428);
  const id = randomUUID(), task = { id, title: '用户甲', status: 'ready', sourceType: 'pdf', sourceAvailable: true, pageCount: 1,
    paragraphs: [{ id: 'p-1', index: 0, pageNumber: 1, original: 'Evidence supports this conclusion.', translation: '证据支持这一结论。',
      highlights: { original: [{ id: 'h-1', start: 0, end: 33, kind: 'user' }], translation: [] } }] };
  for (const [space, title] of [[spaceA, '用户甲'], [spaceB, '用户乙']]) {
    const folder = path.join(dir, 'data/spaces', createHash('sha256').update(space).digest('hex'));
    await mkdir(path.join(folder, 'sources'), { recursive: true });
    await writeFile(path.join(folder, id + '.json'), JSON.stringify({ ...task, title }));
    await writeFile(path.join(folder, 'sources', id + '.pdf'), '%PDF-test-source');
  }
  assert.equal((await request(`/api/tasks/${id}/source`)).status, 200);
  const summaries = await Promise.all([spaceA, spaceB].map(space => request(`/api/tasks/${id}/summary`, space, 'POST', { targetLength: 800 })));
  assert.deepEqual(summaries.map(r => r.status), [200, 200]);
  for (const [space, content] of [[spaceA, '用户甲摘要'], [spaceB, '用户乙摘要']]) {
    const saved = (await (await request(`/api/tasks/${id}`, space)).json()).task;
    assert.equal(saved.summary.content, content); assert.deepEqual(saved.paragraphs, task.paragraphs);
  }
  for (const failure of ['quota', 'incomplete', 'refusal', 'invalid']) {
    mode = failure;
    const response = await request(`/api/tasks/${id}/summary`, spaceA, 'POST', { targetLength: 800 });
    assert.equal(response.status, failure === 'quota' ? 429 : 400);
    const error = await response.json(); assert.ok(!JSON.stringify(error).includes(key));
    assert.equal((await (await request(`/api/tasks/${id}`)).json()).task.summary.content, '用户甲摘要');
  }
  mode = 'ok';
  const created = await request('/api/tasks', spaceA, 'POST', { title: 'API 导入验证', text: 'The reader preserves existing articles. Translation uses the OpenAI API.' });
  assert.ok(created.ok); const importedId = (await created.json()).task.id;
  await until(async () => (await (await request(`/api/tasks/${importedId}`)).json()).task.status === 'ready');
  const imported = (await (await request(`/api/tasks/${importedId}`)).json()).task;
  assert.ok(imported.paragraphs.every(p => p.translation));
  assert.equal((await request(`/api/tasks/${importedId}`, spaceB)).status, 404);
  mode = 'wait'; const previous = calls.length;
  const pending = await request('/api/tasks', spaceA, 'POST', { title: '取消验证', text: 'A fresh article whose analysis will be cancelled before translation.' });
  const pendingId = (await pending.json()).task.id;
  await until(() => calls.length > previous);
  const cancelled = await request(`/api/tasks/${pendingId}/cancel`, spaceA, 'POST');
  assert.equal((await cancelled.json()).task.status, 'cancelled');
  await until(() => aborted);
  assert.equal(calls.length, previous + 1, 'Cancellation must not start translation or retry the request');
  for (const call of calls) {
    assert.equal(call.url, '/v1/responses'); assert.equal(call.headers.authorization, `Bearer ${key}`);
    assert.equal(call.body.model, 'gpt-6.1-sol'); assert.equal(call.body.reasoning.effort, 'medium');
    assert.equal(call.body.service_tier, 'default'); assert.equal(call.body.store, false);
    assert.equal(call.body.text.format.type, 'json_schema'); assert.equal(call.body.text.format.strict, true);
    assert.equal(call.body.text.format.schema.additionalProperties, false);
  }
  await stop(); await start({ OPENAI_API_KEY: '' });
  assert.equal((await (await fetch(url + '/api/health')).json()).available, false);
  const missing = await request(`/api/tasks/${id}/summary`, spaceA, 'POST', { targetLength: 800 });
  assert.equal(missing.status, 503); assert.equal((await missing.json()).code, 'OPENAI_KEY_REQUIRED');
  assert.equal(calls.length, previous + 1, 'No key must never fall back to the CLI');
  await stop();
  console.log(JSON.stringify({ ok: true, checks: ['Responses API with GPT-6.1 Sol, medium and standard speed', 'server-only credentials and .env.local', 'no paid health checks or CLI fallback', 'structured analysis and translation', 'existing PDF, highlights and reading spaces retained', 'quota, truncated output, refusal and malformed JSON keep previous summary', 'cancellation aborts HTTP and stops further batches', 'missing API key is explicit'] }));
} finally {
  if (server) { server.kill(); await new Promise(r => server.once('exit', r)); }
  mock?.closeAllConnections(); if (mock?.listening) await new Promise(r => mock.close(r));
  await rm(dir, { recursive: true, force: true });
}
