import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { parse } from 'cookie';
import { ACCESS_TOKEN_COOKIE } from '../auth/auth.constants';
import { AuthenticatedRequest } from '../auth/auth.guard';
import { AuthSessionsService } from '../auth/auth-sessions.service';

/**
 * For routes guests may use (public hotel view). Sets request.user when a valid session
 * cookie is present, and otherwise lets the request through as a guest. An invalid cookie
 * is treated as a guest rather than an error. Mirrors the itineraries module's guard.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly sessions: AuthSessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = parse(request.headers.cookie ?? '')[ACCESS_TOKEN_COOKIE];
    if (!token) return true;
    try {
      const user = await this.sessions.authenticate(token);
      request.user = { userId: user._id.toString(), role: user.role };
    } catch {
      // Guest access.
    }
    return true;
  }
}
