import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { parse } from 'cookie';
import { Request } from 'express';
import { ACCESS_TOKEN_COOKIE, PASSWORD_CHANGE_TOKEN_COOKIE } from './auth.constants';
import { AuthSessionsService } from './auth-sessions.service';

export interface PasswordChangeIdentity {
  userId: string;
  credentialVersion: number;
  mustChangePassword: boolean;
}

export interface PasswordChangeRequest extends Request {
  passwordChangeIdentity?: PasswordChangeIdentity;
}

@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private readonly sessions: AuthSessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PasswordChangeRequest>();
    const cookies = parse(request.headers.cookie ?? '');
    const limitedToken = cookies[PASSWORD_CHANGE_TOKEN_COOKIE];
    const accessToken = cookies[ACCESS_TOKEN_COOKIE];
    // A presented restricted credential must validate as restricted; never fall
    // back to an unrelated normal session when that proof is stale or malformed.
    if (limitedToken === undefined && !accessToken) throw new UnauthorizedException('Invalid or expired session');
    const user = limitedToken !== undefined
      ? await this.sessions.authenticatePasswordChange(limitedToken)
      : await this.sessions.authenticate(accessToken!);
    request.passwordChangeIdentity = {
      userId: user._id.toString(),
      credentialVersion: user.credentialVersion,
      mustChangePassword: user.mustChangePassword,
    };
    return true;
  }
}
