import { existsSync } from "node:fs";
import { mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { createWorker } from "tesseract.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const python = () => process.env.OCR_PYTHON || path.join(ROOT, ".runtime", "ocr-venv", "bin", "python");

export function ocrProvider() {
  const requested = process.env.OCR_ENGINE || "auto";
  if (!["auto", "rapidocr", "tesseract"].includes(requested)) throw new Error("OCR_ENGINE 必须为 auto、rapidocr 或 tesseract");
  return requested === "auto" ? (process.env.VERCEL !== "1" && existsSync(python()) ? "rapidocr" : "tesseract") : requested;
}

export function ocrReason(content) {
  const text = (content.items || []).map((item) => item.str || "").join("");
  const visible = text.replace(/\s/g, "");
  if (visible.length < 24) return "missing-text";
  const corrupt = (visible.match(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\uE000-\uF8FF]/g) || []).length;
  if (corrupt >= 2 && corrupt / visible.length > 0.01) return "invalid-text";
  return null;
}

function normalizedBox(points, width, height) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const left = Math.max(0, Math.min(...xs) / width);
  const top = Math.max(0, Math.min(...ys) / height);
  return { left, top, width: Math.max(0, Math.min(1, Math.max(...xs) / width) - left), height: Math.max(0, Math.min(1, Math.max(...ys) / height) - top) };
}

export function rapidResultToContent(result, viewport) {
  const items = [];
  for (const line of result.lines || []) {
    if (!line.text?.trim() || line.score < 0.5) continue;
    const rect = normalizedBox(line.box, result.width, result.height);
    if (!rect.width || !rect.height) continue;
    const glyphs = (line.glyphs || []).map((glyph) => ({ start: glyph.start, end: glyph.end, rect: normalizedBox(glyph.box, result.width, result.height) }));
    const itemHeight = rect.height * viewport.height;
    items.push({
      str: line.text, width: rect.width * viewport.width, height: itemHeight,
      transform: [itemHeight, 0, 0, itemHeight, rect.left * viewport.width, (1 - rect.top - rect.height) * viewport.height],
      ocr: true, confidence: line.score, glyphs,
    });
  }
  return { items };
}

export async function createPdfOcrWorker({ signal } = {}) {
  signal?.throwIfAborted();
  const provider = ocrProvider();
  if (provider === "tesseract") {
    const cachePath = process.env.VERCEL === "1" ? path.join(tmpdir(), "longform-tesseract") : path.join(ROOT, ".runtime", "tesseract");
    await mkdir(cachePath, { recursive: true });
    for (const language of ["eng", "chi_sim"]) {
      const cached = path.join(cachePath, `${language}.traineddata`);
      const bundled = path.join(ROOT, `${language}.traineddata`);
      if (!existsSync(cached) && existsSync(bundled)) await copyFile(bundled, cached);
    }
    const worker = await createWorker(["eng", "chi_sim"], 1, { cachePath });
    const cancel = () => { void worker.terminate().catch(() => {}); };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) { await worker.terminate(); signal.throwIfAborted(); }
    return { provider, recognize: (image) => {
      signal?.throwIfAborted();
      const work = worker.recognize(image, {}, { text: true, tsv: true });
      if (!signal) return work;
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      });
    }, terminate: () => { signal?.removeEventListener("abort", cancel); return worker.terminate(); } };
  }
  if (!existsSync(python())) throw new Error("本机 OCR 尚未安装，请先完成 OCR 初始化（npm run setup:ocr）");
  const child = spawn(python(), [path.join(ROOT, "ocr", "worker.py")], { stdio: ["pipe", "pipe", "pipe"] });
  const closed = new Promise(resolve => { child.once("close", resolve); child.once("error", resolve); });
  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill();
    const force = setTimeout(() => child.kill("SIGKILL"), 1000);
    try { await closed; } finally { clearTimeout(force); }
  };
  const pending = new Map();
  let stderr = "";
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const fail = (error) => {
    readyReject(error);
    for (const entry of pending.values()) { clearTimeout(entry.timeout); entry.reject(error); }
    pending.clear();
  };
  const cancel = () => { fail(signal.reason); child.kill(); };
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.on("exit", (code) => fail(new Error(`本机 OCR 进程已退出（${code}）${stderr ? `：${stderr.slice(-500)}` : ""}`)));
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (message.type === "ready") return readyResolve(message);
      if (message.type === "error") return fail(new Error(message.error));
      const entry = pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timeout);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error)); else entry.resolve(message);
    } catch (error) { fail(new Error(`无法读取 OCR 结果：${error.message}`)); }
  });
  const startupTimeout = setTimeout(() => { fail(new Error("本机 OCR 初始化超时")); child.kill(); }, 60_000);
  try { await ready; } catch (error) { signal?.removeEventListener("abort", cancel); await stop(); lines.close(); throw error; } finally { clearTimeout(startupTimeout); }
  return {
    provider,
    recognize(image) {
      signal?.throwIfAborted();
      const id = randomUUID();
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { fail(new Error("本页 OCR 识别超时")); child.kill(); }, 120_000);
        pending.set(id, { resolve, reject, timeout });
        child.stdin.write(`${JSON.stringify({ id, image: image.toString("base64") })}\n`);
      });
    },
    async terminate() {
      signal?.removeEventListener("abort", cancel);
      lines.close();
      child.stdin.end();
      await stop();
    },
  };
}
