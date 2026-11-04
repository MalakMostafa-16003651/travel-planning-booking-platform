import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { validateJwtSecret } from '../config/validate-environment';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthSessionsService } from './auth-sessions.service';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { AuthSession, AuthSessionSchema } from './schemas/auth-session.schema';

@Module({
  imports: [
    UsersModule,
    ConfigModule,
    MongooseModule.forFeature([{ name: AuthSession.name, schema: AuthSessionSchema }]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: validateJwtSecret(config.get<unknown>('JWT_SECRET')),
        signOptions: {
          algorithm: 'HS256',
          issuer: 'travel-planning-booking-platform',
          audience: 'travel-platform-api',
        },
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: 'travel-planning-booking-platform',
          audience: 'travel-platform-api',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, AuthSessionsService, AuthGuard],
  // Nest creates guard instances in consuming modules, so their injected dependency
  // must also be available there. This exports a provider, not an HTTP endpoint.
  exports: [AuthGuard, AuthSessionsService],
})
export class AuthModule {}
