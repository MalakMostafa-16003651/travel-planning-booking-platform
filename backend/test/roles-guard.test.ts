import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AuthenticatedRequest } from '../src/auth/auth.guard';
import { Roles } from '../src/auth/roles.decorator';
import { RolesGuard } from '../src/auth/roles.guard';
import { UserRole } from '../src/common/enums/user-role.enum';

@Roles(UserRole.USER, UserRole.ADMIN, UserRole.AIRLINE_MODERATOR, UserRole.HOTEL_MODERATOR)
class AllRolesController {
  index(): void {}
}

@Roles(UserRole.ADMIN)
class AdminController {
  index(): void {}

  @Roles(UserRole.USER)
  userOnly(): void {}

  @Roles()
  disabled(): void {}
}

class UnconfiguredController {
  index(): void {}

  @Roles(UserRole.ADMIN)
  adminOnly(): void {}
}

@Roles()
class EmptyPolicyController {
  index(): void {}
}

function identity(role: UserRole): NonNullable<AuthenticatedRequest['user']> {
  return { userId: '507f1f77bcf86cd799439011', role };
}

function requestContext(
  controller: new () => unknown,
  handler: (...args: never[]) => unknown,
  request: Partial<AuthenticatedRequest> = {},
): ExecutionContextHost {
  const context = new ExecutionContextHost([request], controller, handler);
  context.setType('http');
  return context;
}

describe('reusable role authorization', () => {
  const guard = new RolesGuard(new Reflector());

  it('accepts each shared role when the class policy explicitly permits it', () => {
    for (const role of Object.values(UserRole)) {
      const context = requestContext(AllRolesController, AllRolesController.prototype.index, { user: identity(role) });
      assert.equal(guard.canActivate(context), true, role);
    }
  });

  it('rejects every non-admin role from an admin policy with 403', () => {
    for (const role of [UserRole.USER, UserRole.AIRLINE_MODERATOR, UserRole.HOTEL_MODERATOR]) {
      const context = requestContext(AdminController, AdminController.prototype.index, { user: identity(role) });
      assert.throws(() => guard.canActivate(context), (error: unknown) => {
        assert.ok(error instanceof ForbiddenException);
        assert.equal(error.getStatus(), 403);
        return true;
      });
    }
    assert.equal(guard.canActivate(requestContext(AdminController, AdminController.prototype.index, {
      user: identity(UserRole.ADMIN),
    })), true);
  });

  it('uses a method policy in preference to the class policy rather than combining permissions', () => {
    assert.equal(guard.canActivate(requestContext(AdminController, AdminController.prototype.userOnly, {
      user: identity(UserRole.USER),
    })), true);
    assert.throws(() => guard.canActivate(requestContext(AdminController, AdminController.prototype.userOnly, {
      user: identity(UserRole.ADMIN),
    })), ForbiddenException);
  });

  it('supports a method policy without requiring class metadata', () => {
    assert.equal(guard.canActivate(requestContext(UnconfiguredController, UnconfiguredController.prototype.adminOnly, {
      user: identity(UserRole.ADMIN),
    })), true);
    assert.throws(() => guard.canActivate(requestContext(UnconfiguredController, UnconfiguredController.prototype.adminOnly, {
      user: identity(UserRole.USER),
    })), ForbiddenException);
  });

  it('fails closed for absent policies and empty policies at either level', () => {
    const requests = [
      requestContext(UnconfiguredController, UnconfiguredController.prototype.index, { user: identity(UserRole.ADMIN) }),
      requestContext(EmptyPolicyController, EmptyPolicyController.prototype.index, { user: identity(UserRole.ADMIN) }),
      requestContext(AdminController, AdminController.prototype.disabled, { user: identity(UserRole.ADMIN) }),
    ];
    for (const context of requests) {
      assert.throws(() => guard.canActivate(context), ForbiddenException);
    }
  });

  it('requires an established identity even when body or query fields claim an allowed role', () => {
    const context = requestContext(AdminController, AdminController.prototype.index, {
      body: { userId: '507f1f77bcf86cd799439011', role: UserRole.ADMIN },
      query: { role: UserRole.ADMIN },
    });
    assert.throws(() => guard.canActivate(context), (error: unknown) => {
      assert.ok(error instanceof UnauthorizedException);
      assert.equal(error.getStatus(), 401);
      return true;
    });
    assert.throws(() => guard.canActivate(requestContext(UnconfiguredController, UnconfiguredController.prototype.index)),
      UnauthorizedException);
  });

  it('does not treat an incomplete identity containing only an allowed role as authenticated', () => {
    for (const user of [{ role: UserRole.ADMIN }, { userId: '', role: UserRole.ADMIN }]) {
      const context = requestContext(AdminController, AdminController.prototype.index, {
        user: user as NonNullable<AuthenticatedRequest['user']>,
      });
      assert.throws(() => guard.canActivate(context), UnauthorizedException);
    }
  });
});
