const SPACE = 'longform.reading.space.v1';
let enabled = false, uploadLimit = 25;
export function configureReadingSpace(health) {
  enabled = Boolean(health.browserSpaces);
  uploadLimit = health.uploadLimitMB || 25;
  if (enabled && !/^[a-f0-9]{64}$/.test(localStorage.getItem(SPACE) || '')) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    localStorage.setItem(SPACE, [...bytes].map(x => x.toString(16).padStart(2, '0')).join(''));
  }
  // Retire the old credential without touching the reading-space capability.
  localStorage.removeItem('longform.deepseek.key.v1');
}
export const uploadLimitMB = () => uploadLimit;
export function workspaceHeaders() { return enabled ? { 'X-Reading-Space': localStorage.getItem(SPACE) } : {}; }
export function apiFetch(url, options = {}) {
  const target = new URL(url, location.href);
  if (target.origin !== location.origin || !target.pathname.startsWith('/api/')) return fetch(url, options);
  const headers = new Headers(options.headers);
  for (const [key, value] of Object.entries(workspaceHeaders())) headers.set(key, value);
  return fetch(url, { ...options, headers });
}
