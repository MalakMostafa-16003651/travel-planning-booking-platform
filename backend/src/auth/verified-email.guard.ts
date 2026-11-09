import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard';
import { EmailEligibilityService } from './email-eligibility.service';
@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  constructor(private readonly eligibility: EmailEligibilityService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user?.userId) throw new UnauthorizedException('Invalid or expired session');
    await this.eligibility.assertCanBook(request.user.userId); return true;
  }
}
