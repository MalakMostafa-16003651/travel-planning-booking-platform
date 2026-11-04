import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthenticatedRequest } from './auth.guard';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // AuthGuard must establish the identity before this guard checks its role.
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user || typeof request.user.userId !== 'string' || request.user.userId.length === 0) {
      throw new UnauthorizedException('Authentication is required');
    }

    const allowedRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // An unconfigured/empty policy never silently turns a protected route public.
    if (!Array.isArray(allowedRoles) || !allowedRoles.includes(request.user.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
