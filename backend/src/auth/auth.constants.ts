export const ACCESS_TOKEN_COOKIE = '__Host-accessToken';
export const REFRESH_TOKEN_COOKIE = '__Host-refreshToken';
export const PASSWORD_CHANGE_TOKEN_COOKIE = '__Host-passwordChangeToken';
export const AUTH_COOKIE_OPTIONS = Object.freeze({
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
});
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const PASSWORD_CHANGE_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const FAILED_LOGIN_LIMIT = 5;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
