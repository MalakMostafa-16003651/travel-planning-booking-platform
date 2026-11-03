import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { parse } from 'cookie';
import { Request } from 'express';
import { UserRole } from '../common/enums/user-role.enum';
import { ACCESS_TOKEN_COOKIE } from './auth.constants';
import { AuthSessionsService } from './auth-sessions.service';
import { AuthenticatedUserDto } from './dto/authenticated-user.dto';

export interface AuthenticatedRequest extends Request {
  user?: { userId: string; role: UserRole };
  authenticatedUser?: AuthenticatedUserDto;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessions: AuthSessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = parse(request.headers.cookie ?? '')[ACCESS_TOKEN_COOKIE];
    if (!token) throw new UnauthorizedException('Invalid or expired session');
    const user = await this.sessions.authenticate(token);
    request.user = { userId: user._id.toString(), role: user.role };
    request.authenticatedUser = AuthenticatedUserDto.fromUser(user);
    return true;
  }
}
