import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AuthModule } from '../auth/auth.module';
import { Hotel, HotelSchema } from '../hotels/schemas/hotel.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminProvidersController } from './admin-providers.controller';
import { AdminProvidersService } from './admin-providers.service';

/** Person 2: administrator features (ACC-13 to ACC-17, GEN-10). Grows one feature per PR. */
@Module({
  imports: [
    AuthModule,
    AuditLogsModule,
    NotificationsModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      // ACC-15: only isActive is changed here; Persons 3 and 5 own the rest of these documents.
      { name: Airline.name, schema: AirlineSchema },
      { name: Hotel.name, schema: HotelSchema },
    ]),
  ],
  controllers: [AdminAccountsController, AdminProvidersController],
  providers: [AdminAccountsService, AdminProvidersService],
})
export class AdminModule {}
