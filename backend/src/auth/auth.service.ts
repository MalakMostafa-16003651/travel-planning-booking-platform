import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { RegisteredUserDto } from './dto/registered-user.dto';
import { PasswordService } from './password.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
  ) {}

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
