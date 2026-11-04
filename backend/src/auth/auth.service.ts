import { ForbiddenException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AccountStatus } from '../common/enums/account-status.enum';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisteredUserDto } from './dto/registered-user.dto';
import { PasswordService } from './password.service';

const LOCKOUT_MESSAGE = 'Account temporarily locked. Try again later.';

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyPasswordHash!: string;

  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Unknown email addresses still incur the same password-derivation work.
    this.dummyPasswordHash = await this.passwords.hash(randomBytes(32).toString('hex'));
  }

  async verifyCredentials(input: LoginDto): Promise<UserDocument> {
    const user = await this.users.findForAuthentication(input.email);
    const validPassword = await this.passwords.verify(input.password, user?.passwordHash ?? this.dummyPasswordHash);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!validPassword) {
      const locked = await this.users.recordFailedLogin(user._id.toString(), user.passwordHash);
      throw new UnauthorizedException(locked ? LOCKOUT_MESSAGE : 'Invalid email or password');
    }
    // Only verified credentials can reveal an account's suspension status.
    if (user.status === AccountStatus.SUSPENDED) {
      throw new ForbiddenException('Account is suspended');
    }
    if (user.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid email or password');
    }
    // This conditional write is the successful-login ordering point. A concurrent
    // fifth failure that locked first prevents a stale verifier from clearing it.
    const authenticated = await this.users.resetFailedLoginAttempts(
      user._id.toString(), user.passwordHash, user.credentialVersion,
    );
    if (!authenticated) {
      const locked = await this.users.isLoginLocked(user._id.toString(), user.passwordHash);
      throw new UnauthorizedException(locked ? LOCKOUT_MESSAGE : 'Invalid email or password');
    }
    return authenticated;
  }

  async register(input: RegisterDto): Promise<RegisteredUserDto> {
    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.users.createRegisteredUser({
      name: input.name,
      email: input.email,
      passwordHash,
      termsAcceptedAt: new Date(),
    });
    return RegisteredUserDto.fromUser(user);
  }
}
