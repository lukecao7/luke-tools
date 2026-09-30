import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// launchd owns this process, so it does not depend on a Codex tool session.
// The job lasts for this macOS login; it does not install login startup items.
const root = fileURLToPath(new URL("../", import.meta.url));
const label = "com.lukecao.longform-reading";
const command = process.argv[2] || "start";
const launchctl = args => spawnSync("/bin/launchctl", args, { encoding: "utf8" });
const existing = launchctl(["list", label]);
if (command === "stop") {
  if (existing.status === 0) {
    const result = launchctl(["remove", label]);
    if (result.status !== 0) throw new Error(result.stderr);
  }
  console.log("本地后台服务已停止。");
} else if (command === "start") {
  if (existing.status !== 0) {
    mkdirSync(path.join(root, ".runtime", "local-service"), { recursive: true });
    const result = launchctl([
      "submit", "-l", label,
      "-o", path.join(root, ".runtime", "local-service", "stdout.log"),
      "-e", path.join(root, ".runtime", "local-service", "stderr.log"),
      "--", "/usr/bin/env", `PATH=${process.env.PATH}`,
      "PORT=4173", "VERCEL=0", "STORAGE_PROVIDER=local", "AI_PROVIDER=codex",
      process.execPath, path.join(root, "server.mjs"),
    ]);
    if (result.status !== 0) throw new Error(result.stderr);
  }
  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:4173/api/health", { signal: AbortSignal.timeout(2000) });
      if (response.ok && (await response.json()).ok) { healthy = true; break; }
    } catch { /* The service may still be starting. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!healthy) throw new Error("本地服务未能启动，请检查 .runtime/local-service 下的日志。");
  console.log("本地服务已在后台运行：http://127.0.0.1:4173/");
} else {
  throw new Error("使用 start 或 stop。");
}
