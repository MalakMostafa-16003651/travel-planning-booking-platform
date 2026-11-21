import 'server-only';

export function backendUrl(): URL {
  const url = new URL(process.env.BACKEND_URL || 'http://localhost:3000');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('BACKEND_URL must be an origin without credentials or a path');
  }
  return url;
}
export function authCookies(cookie: string): string {
  const names = new Set(['__Host-accessToken', '__Host-refreshToken', '__Host-passwordChangeToken']);
  return cookie.split(';').map(part => part.trim()).filter(part => names.has(part.split('=')[0])).join('; ');
}
