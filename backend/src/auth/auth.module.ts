import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService],
})
export class AuthModule {}
