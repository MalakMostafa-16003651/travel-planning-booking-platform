import type { Response } from 'express';
import { ACCESS_TOKEN_COOKIE, AUTH_COOKIE_OPTIONS, PASSWORD_CHANGE_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './auth.constants';

export function clearAuthenticationCookies(response: Response): void {
  response.clearCookie(ACCESS_TOKEN_COOKIE, AUTH_COOKIE_OPTIONS);
  response.clearCookie(REFRESH_TOKEN_COOKIE, AUTH_COOKIE_OPTIONS);
  response.clearCookie(PASSWORD_CHANGE_TOKEN_COOKIE, AUTH_COOKIE_OPTIONS);
}