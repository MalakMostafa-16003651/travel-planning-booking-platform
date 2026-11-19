import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateModeratorDto } from '../src/admin/dto/create-moderator.dto';
import { AdminResetPasswordDto } from '../src/auth/dto/admin-reset-password.dto';
import { ChangePasswordDto } from '../src/auth/dto/change-password.dto';
import { LoginDto } from '../src/auth/dto/login.dto';
import { RegisterDto } from '../src/auth/dto/register.dto';
import { ResetPasswordDto } from '../src/auth/dto/reset-password.dto';
import { UserRole } from '../src/common/enums/user-role.enum';

const password128 = `A1${'x'.repeat(126)}`;
const password129 = `${password128}x`;

function errors(dto: new () => object, input: Record<string, unknown>) {
  return validateSync(plainToInstance(dto, input), { whitelist: true, forbidNonWhitelisted: true });
}

describe('new credential length limits across account entry points', () => {
  const entryPoints: Array<[string, new () => object, string, Record<string, unknown>]> = [
    ['registration', RegisterDto, 'password', { name: 'Traveler', email: 'traveler@example.com', termsAccepted: true }],
    ['password change', ChangePasswordDto, 'newPassword', { currentPassword: 'Previous123' }],
    ['password recovery', ResetPasswordDto, 'newPassword', { token: 'a'.repeat(64) }],
    ['administrator reset', AdminResetPasswordDto, 'temporaryPassword', {}],
    ['moderator creation', CreateModeratorDto, 'temporaryPassword', {
      name: 'Airline Desk', email: 'desk@example.com', role: UserRole.AIRLINE_MODERATOR,
      providerId: '507f1f77bcf86cd799439011',
    }],
  ];

  for (const [label, dto, field, input] of entryPoints) {
    it(`${label} accepts 128 characters and rejects 129`, () => {
      assert.deepEqual(errors(dto, { ...input, [field]: password128 }), []);
      const rejected = errors(dto, { ...input, [field]: password129 });
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0].property, field);
      assert.ok(rejected[0].constraints?.maxLength);
    });
  }

  it('counts Unicode characters and preserves surrounding password whitespace', () => {
    const input = { name: 'Traveler', email: 'traveler@example.com', termsAccepted: true };
    const unicode128 = `${'🔒'.repeat(126)}A1`;
    assert.deepEqual(errors(RegisterDto, { ...input, password: unicode128 }), []);
    const passwordWithWhitespace = ` ${password128} `;
    const rejected = errors(RegisterDto, { ...input, password: passwordWithWhitespace });
    assert.ok(rejected.find((error) => error.property === 'password')?.constraints?.maxLength);
  });

  it('keeps existing longer credentials usable for login and current-password verification', () => {
    assert.deepEqual(errors(LoginDto, { email: 'traveler@example.com', password: password129 }), []);
    assert.deepEqual(errors(ChangePasswordDto, { currentPassword: password129, newPassword: password128 }), []);
  });
});
