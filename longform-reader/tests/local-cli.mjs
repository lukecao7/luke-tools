import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, symlink, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..'), dir = await mkdtemp(path.join(tmpdir(), 'reading-local-cli-'));
const spaceA = 'a'.repeat(64), spaceB = 'b'.repeat(64), hash = s => createHash('sha256').update(s).digest('hex');
let server;
const until = async check => { for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 50)); } throw Error('Timed out'); };
try {
  for (const name of ['server.mjs', 'reading-space.mjs', 'task-updates.mjs', 'package.json']) await copyFile(path.join(root, name), path.join(dir, name));
  for (const name of ['public', 'schemas', 'ocr', 'node_modules']) await symlink(path.join(root, name), path.join(dir, name));
  await mkdir(path.join(dir, 'bin'));
  const mock = path.join(dir, 'bin', 'codex');
  await writeFile(mock, `#!${process.execPath}
import fs from 'node:fs';
if (process.argv.includes('--version')) { console.log('codex-local-test'); process.exit(0); }
let prompt = ''; for await (const chunk of process.stdin) prompt += chunk;
fs.appendFileSync(process.env.TEST_DIR + '/calls.jsonl', JSON.stringify({ args: process.argv.slice(2), prompt }) + '\\n');
if (fs.existsSync(process.env.TEST_DIR + '/fail')) { console.error('Synthetic CLI failure'); process.exit(1); }
let result;
if (prompt.includes('SOURCE_BLOCKS:')) {
  const items = JSON.parse(prompt.split('SOURCE_BLOCKS:').at(-1));
  result = { body_ids: items.map(p => p.id), figures: [], highlights: [] };
} else if (prompt.includes('SOURCE_ITEMS:')) {
  const items = JSON.parse(prompt.split('SOURCE_ITEMS:').at(-1));
  result = { translations: Object.fromEntries(items.map(p => [p.id, Object.fromEntries([...p.text.matchAll(/^\\[(s\\d+)\\]/gm)].map(m => [m[1], '验证译文。']))])) };
} else result = { title: '验证摘要', summary: prompt.includes('DOCUMENT_TITLE: "用户甲"') ? '用户甲摘要' : '用户乙摘要', answer: '验证解释。' };
fs.writeFileSync(process.argv[process.argv.indexOf('-o') + 1], JSON.stringify(result));
`);
  await chmod(mock, 0o755);
  const listener = createServer().listen(0, '127.0.0.1'); await new Promise(r => listener.once('listening', r));
  const port = listener.address().port; await new Promise(r => listener.close(r));
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['server.mjs'], { cwd: dir, env: { ...process.env, CODEX_BIN: mock, READING_SPACES: '1',
    CODEX_MODEL: 'gpt-6.1-sol', CODEX_REASONING_EFFORT: 'medium', VERCEL: '0', STORAGE_PROVIDER: 'local', APP_PASSWORD: '', PORT: String(port), TEST_DIR: dir }, stdio: 'ignore' });
  await until(() => fetch(url + '/api/health').then(r => r.ok, () => false));
  const request = (route, space, method = 'GET', body) => fetch(url + route, { method,
    headers: { ...(space ? { 'X-Reading-Space': space } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const health = await (await fetch(url + '/api/health')).json();
  assert.equal(health.model, 'gpt-6.1-sol'); assert.equal(health.reasoningEffort, 'medium'); assert.equal(health.serviceTier, 'default');
  assert.equal(health.provider, 'codex'); assert.equal(health.browserSpaces, true); assert.equal(health.userOwnedKeys, undefined);
  assert.equal((await request('/api/tasks')).status, 428);
  assert.equal((await request('/api/deepseek/balance', spaceA)).status, 404);
  const id = randomUUID(), task = { id, title: '用户甲', status: 'ready', sourceType: 'pdf', sourceAvailable: true, pageCount: 1,
    paragraphs: [{ id: 'p-1', index: 0, pageNumber: 1, original: 'Evidence supports this conclusion.', translation: '证据支持这一结论。',
      highlights: { original: [{ id: 'h-1', start: 0, end: 33, kind: 'user' }], translation: [] } }] };
  for (const [space, title] of [[spaceA, '用户甲'], [spaceB, '用户乙']]) {
    const folder = path.join(dir, 'data/spaces', hash(space)); await mkdir(path.join(folder, 'sources'), { recursive: true });
    await writeFile(path.join(folder, id + '.json'), JSON.stringify({ ...task, title }));
    await writeFile(path.join(folder, 'sources', id + '.pdf'), '%PDF-test-source');
  }
  assert.equal((await request(`/api/tasks/${id}/source`, spaceA)).status, 200);
  assert.equal((await request(`/api/tasks/${id}`, 'c'.repeat(64))).status, 404);
  const summaries = await Promise.all([spaceA, spaceB].map(space => request(`/api/tasks/${id}/summary`, space, 'POST', { targetLength: 800 })));
  assert.deepEqual(summaries.map(r => r.status), [200, 200], 'No API key or balance required');
  for (const [space, content] of [[spaceA, '用户甲摘要'], [spaceB, '用户乙摘要']]) {
    const saved = (await (await request(`/api/tasks/${id}`, space)).json()).task;
    assert.equal(saved.summary.content, content); assert.deepEqual(saved.paragraphs, task.paragraphs);
  }
  await writeFile(path.join(dir, 'fail'), '1');
  assert.equal((await request(`/api/tasks/${id}/summary`, spaceA, 'POST', { targetLength: 800 })).status, 400);
  assert.equal((await (await request(`/api/tasks/${id}`, spaceA)).json()).task.summary.content, '用户甲摘要');
  await rm(path.join(dir, 'fail'));
  const created = await request('/api/tasks', spaceA, 'POST', { title: 'CLI 导入验证', text: 'The reader preserves existing articles. Translation uses the local command line.' });
  assert.ok(created.ok); const importedId = (await created.json()).task.id;
  await until(async () => (await (await request(`/api/tasks/${importedId}`, spaceA)).json()).task.status === 'ready');
  const imported = (await (await request(`/api/tasks/${importedId}`, spaceA)).json()).task;
  assert.ok(imported.paragraphs.every(p => p.translation));
  assert.equal((await request(`/api/tasks/${importedId}`, spaceB)).status, 404);
  const calls = (await readFile(path.join(dir, 'calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  for (const { args } of calls) {
    assert.equal(args[args.indexOf('--model') + 1], 'gpt-6.1-sol');
    assert.ok(args.includes('model_reasoning_effort="medium"')); assert.ok(args.includes('service_tier="default"'));
    assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only'); assert.ok(args.includes('--ignore-user-config'));
  }
  console.log(JSON.stringify({ ok: true, checks: ['CLI model, effort and standard speed', 'imports and summaries without API keys', 'existing PDF and highlights preserved', 'browser-space isolation', 'previous summary retained after CLI failure'] }));
} finally { if (server) { server.kill(); await new Promise(r => server.once('exit', r)); } await rm(dir, { recursive: true, force: true }); }
