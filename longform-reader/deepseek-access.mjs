import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

export const requestAccess = new AsyncLocalStorage();
export const userOwned = process.env.VERCEL === '1' || process.env.USER_OWNED_KEYS === '1';
export const deepseekModel = 'deepseek-v4-flash';
const baseURL = process.env.VERCEL === '1' ? 'https://api.deepseek.com' : (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com');
export function accessError(code, message, status = 400) { return Object.assign(new Error(message), {code,status}); }
export function workspace() {
  if (!userOwned) return '';
  const owner = requestAccess.getStore()?.owner;
  if (!owner) throw accessError('WORKSPACE_REQUIRED','无法读取本浏览器的阅读空间，请刷新页面。',428);
  return owner;
}
export function jobKey(id) { return `${workspace()}:${id}`; }
export function userKey() {
  const key = userOwned ? requestAccess.getStore()?.apiKey : process.env.DEEPSEEK_API_KEY;
  if (!key) throw accessError('DEEPSEEK_KEY_REQUIRED','请先绑定你的 DeepSeek API Key。',428);
  return key;
}
export function accessMiddleware(request,response,next) {
  if (!userOwned || request.path === '/health') return next();
  const token = request.get('X-Reading-Space');
  if (!/^[a-f0-9]{64}$/.test(token || '')) return next(accessError('WORKSPACE_REQUIRED','无法读取本浏览器的阅读空间，请刷新页面。',428));
  const apiKey = request.get('X-DeepSeek-Key') || '';
  if (apiKey && !/^sk-[A-Za-z0-9_-]{12,240}$/.test(apiKey)) return next(accessError('DEEPSEEK_KEY_INVALID','API Key 格式不正确，请重新复制完整的 DeepSeek Key。',401));
  // The browser secret is an anonymous capability; only its hash names storage.
  // API keys live only in this request context, never in a task or a server file.
  requestAccess.run({owner:createHash('sha256').update(token).digest('hex'),apiKey},next);
}
export function providerError(status) {
  if (status===401) return accessError('DEEPSEEK_KEY_INVALID','DeepSeek API Key 无效或已撤销，请重新绑定。',401);
  if (status===402) return accessError('DEEPSEEK_BALANCE_LOW','DeepSeek 余额不足。已完成的内容会保留，请充值后继续。',402);
  if (status===429) return accessError('DEEPSEEK_RATE_LIMIT','DeepSeek 请求过于频繁，请稍后重试。',429);
  return accessError('DEEPSEEK_UNAVAILABLE',`DeepSeek 暂时无法完成请求（${status}），请稍后重试。`,502);
}
export async function fetchBalance() {
  let response;
  try { response=await fetch(`${baseURL}/user/balance`, {headers:{Authorization:`Bearer ${userKey()}`},signal:AbortSignal.timeout(12000)}); }
  catch(error) { if(error.code==='DEEPSEEK_KEY_REQUIRED')throw error;throw accessError('DEEPSEEK_UNAVAILABLE','暂时无法查询 DeepSeek 余额，请稍后重试。',502); }
  if(!response.ok)throw providerError(response.status);
  const data=await response.json();
  if(typeof data.is_available!=='boolean' || !Array.isArray(data.balance_infos))throw accessError('DEEPSEEK_UNAVAILABLE','暂时无法读取 DeepSeek 余额。',502);
  return {available:data.is_available,balances:data.balance_infos.map(b=>({currency:b.currency,total:String(b.total_balance)})),checkedAt:new Date().toISOString()};
}
export async function requireBalance() {
  const balance=await fetchBalance();
  if(!balance.available)throw providerError(402);
  return balance;
}
export const deepseekURL = baseURL;
