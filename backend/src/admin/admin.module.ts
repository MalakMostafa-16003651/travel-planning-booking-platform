import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';

/** Person 2: administrator features (ACC-13 to ACC-17, GEN-10). Grows one feature per PR. */
@Module({
  imports: [
    AuthModule,
    AuditLogsModule,
    NotificationsModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [AdminAccountsController],
  providers: [AdminAccountsService],
})
export class AdminModule {}
