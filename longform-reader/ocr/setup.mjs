import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const setup = spawnSync("uv", ["venv", "--allow-existing", ".runtime/ocr-venv", "--python", "3.13"], { cwd: root, stdio: "inherit" });
if (setup.error || setup.status !== 0) throw new Error("请先安装 uv，再重新运行 npm run setup:ocr");
const install = spawnSync("uv", ["pip", "install", "--python", ".runtime/ocr-venv/bin/python", "-r", "ocr/requirements.txt"], { cwd: root, stdio: "inherit" });
if (install.error || install.status !== 0) process.exit(1);
console.log("本机 OCR 已安装。扫描页将使用 RapidOCR，无按页 API 费用。");
