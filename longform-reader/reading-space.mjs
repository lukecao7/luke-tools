import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

const requestAccess = new AsyncLocalStorage();
export const browserSpaces = process.env.READING_SPACES === '1' || process.env.VERCEL === '1';
export function workspace() {
  if (!browserSpaces) return '';
  const owner = requestAccess.getStore()?.owner;
  if (!owner) throw Object.assign(new Error('无法读取本浏览器的阅读空间，请刷新页面。'), { code: 'WORKSPACE_REQUIRED', status: 428 });
  return owner;
}
export function jobKey(id) { return `${workspace()}:${id}`; }
export function accessMiddleware(request, _response, next) {
  if (!browserSpaces || request.path === '/health') return next();
  const token = request.get('X-Reading-Space');
  if (!/^[a-f0-9]{64}$/.test(token || '')) return next(Object.assign(new Error('无法读取本浏览器的阅读空间，请刷新页面。'), { code: 'WORKSPACE_REQUIRED', status: 428 }));
  // Preserve the existing anonymous browser capability and storage paths.
  requestAccess.run({ owner: createHash('sha256').update(token).digest('hex') }, next);
}
