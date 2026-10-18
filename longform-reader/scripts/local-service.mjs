import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// A detached child keeps the local reader available after the starting shell
// exits, without depending on launchd access to this Desktop checkout.
const root = fileURLToPath(new URL("../", import.meta.url));
const label = "com.lukecao.longform-reading";
const command = process.argv[2] || "start";
const launchctl = args => spawnSync("/bin/launchctl", args, { encoding: "utf8" });
const runtime = path.join(root, '.runtime', 'local-service');
const pidFile = path.join(runtime, 'server.pid');
let pid;
try { pid = Number(readFileSync(pidFile, 'utf8')); } catch { /* No managed process yet. */ }
const processCommand = Number.isInteger(pid) && pid > 0 ? spawnSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).stdout?.trim() : '';
const managed = processCommand === `${process.execPath} ${path.join(root, 'server.mjs')}`;
async function healthy() {
  try {
    const response = await fetch('http://127.0.0.1:4173/api/health', { signal: AbortSignal.timeout(2000) });
    return response.ok && (await response.json()).ok;
  } catch { return false; }
}
if (command === "stop") {
  if (managed) process.kill(pid, 'SIGTERM');
  if (launchctl(['list', label]).status === 0) launchctl(['remove', label]);
  if (!managed && await healthy()) throw new Error('服务在其他窗口运行，请在该启动窗口按 Control-C 停止。');
  try { unlinkSync(pidFile); } catch { /* Already stopped. */ }
  console.log("本地后台服务已停止。");
} else if (command === "start") {
  if (!await healthy() && !managed) {
    if (launchctl(['list', label]).status === 0) launchctl(['remove', label]);
    mkdirSync(runtime, { recursive: true });
    const output = openSync(path.join(runtime, 'stdout.log'), 'a');
    const errors = openSync(path.join(runtime, 'stderr.log'), 'a');
    try {
      const child = spawn(process.execPath, [path.join(root, 'server.mjs')], { cwd: root, detached: true,
        env: { ...process.env, PORT: '4173', VERCEL: '0', STORAGE_PROVIDER: 'local', AI_PROVIDER: 'deepseek', USER_OWNED_KEYS: '1', APP_PASSWORD: '' },
        stdio: ['ignore', output, errors] });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      writeFileSync(pidFile, String(child.pid)); child.unref();
    } finally { closeSync(output); closeSync(errors); }
  }
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await healthy()) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error("本地服务未能启动，请检查 .runtime/local-service 下的日志。");
  console.log("本地服务已在后台运行：http://127.0.0.1:4173/");
} else {
  throw new Error("使用 start 或 stop。");
}
