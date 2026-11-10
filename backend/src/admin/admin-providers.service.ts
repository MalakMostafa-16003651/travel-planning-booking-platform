import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Airline, AirlineDocument } from '../airlines/schemas/airline.schema';
import { AuditAction, AuditTargetType } from '../audit-logs/audit-log.enums';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import { NotificationType } from '../notifications/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { ProviderType } from './dto/provider-params.dto';
import { ProviderStatusDto } from './dto/provider-status-response.dto';

@Injectable()
export class AdminProvidersService {
  private readonly logger = new Logger(AdminProvidersService.name);

  constructor(
    @InjectModel(Airline.name) private readonly airlines: Model<AirlineDocument>,
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly auditLogs: AuditLogsService,
    private readonly notifications: NotificationsService,
    private readonly hotelBookings: HotelBookingsService,
  ) {}

  /**
   * ACC-15: a deactivated airline or hotel is hidden from search and cannot be booked
   * (Persons 3, 4 and 5 already enforce isActive); its existing Confirmed bookings stay valid.
   * This is separate from suspending the provider's moderator account.
   */
  deactivate(adminId: string, type: ProviderType, providerId: string): Promise<ProviderStatusDto> {
    return this.setActive(adminId, type, providerId, false);
  }

  /** ACC-15: the provider becomes searchable and bookable again. */
  reactivate(adminId: string, type: ProviderType, providerId: string): Promise<ProviderStatusDto> {
    return this.setActive(adminId, type, providerId, true);
  }

  private async setActive(adminId: string, type: ProviderType, providerId: string, isActive: boolean): Promise<ProviderStatusDto> {
    const _id = new Types.ObjectId(providerId);
    const model: Model<AirlineDocument> | Model<HotelDocument> = type === 'airline' ? this.airlines : this.hotels;

    const result = await this.connection.transaction(async (session) => {
      const updated = await (model as Model<AirlineDocument>).findOneAndUpdate(
        { _id, isActive: !isActive },
        { $set: { isActive } },
        { returnDocument: 'after', projection: { name: 1, isActive: 1 }, session },
      ).lean().exec();
      if (!updated) {
        const exists = await (model as Model<AirlineDocument>).exists({ _id }).session(session).exec();
        if (!exists) throw new NotFoundException(`${type === 'airline' ? 'Airline' : 'Hotel'} not found`);
        throw new ConflictException(`${type === 'airline' ? 'Airline' : 'Hotel'} is already ${isActive ? 'active' : 'deactivated'}`);
      }
      await this.auditLogs.log({
        adminId,
        action: isActive ? AuditAction.PROVIDER_REACTIVATED : AuditAction.PROVIDER_DEACTIVATED,
        targetType: type === 'airline' ? AuditTargetType.AIRLINE : AuditTargetType.HOTEL,
        targetId: providerId,
      }, session);
      const notifiedCount = await this.notifyAffected(type, _id, updated.name, isActive, session);
      return { type, providerId, name: updated.name, isActive: updated.isActive, notifiedCount };
    });
    if (type === 'hotel' && !isActive) {
      // PR70's existing helper preserves confirmed stays. Payments are reconciled by maintenance.
      // A cleanup outage does not pretend the committed provider action was rolled back.
      try { await this.hotelBookings.releasePendingHoldsForHotel(providerId); }
      catch { this.logger.error(`Pending holds for hotel ${providerId} will remain until expiry cleanup`); }
    }
    return result;
  }

  /** ACC-15 / GEN-01: status, audit and persisted inbox entries share one commit. */
  private async notifyAffected(type: ProviderType, providerId: Types.ObjectId, name: string, isActive: boolean, session: ClientSession): Promise<number> {
    // Sequential operations: a MongoDB session does not support parallel transaction operations.
    const moderatorIds = await this.moderatorIds(type, providerId, session);
    const customerIds = isActive ? [] : await this.confirmedCustomerIds(type, providerId, session);
    const label = type === 'airline' ? 'airline' : 'hotel';
    const notificationType = isActive ? NotificationType.PROVIDER_REACTIVATED : NotificationType.PROVIDER_DEACTIVATED;
    await this.notifications.notifyMany(moderatorIds, notificationType, isActive
      ? `Your ${label} ${name} has been reactivated by an administrator and is visible again.`
      : `Your ${label} ${name} has been deactivated by an administrator. It is hidden from search and cannot be booked. Existing confirmed bookings remain valid.`, session);
    const customers = customerIds.filter((id) => !moderatorIds.includes(id));
    await this.notifications.notifyMany(customers, notificationType,
      `${name} has been deactivated on our platform. Your confirmed booking with this ${label} remains valid.`, session);
    return moderatorIds.length + customers.length;
  }

  /** Reads the agreed moderatorassignments contract: moderatorId plus airlineId or hotelId. */
  private async moderatorIds(type: ProviderType, providerId: Types.ObjectId, session: ClientSession): Promise<string[]> {
    const field = type === 'airline' ? 'airlineId' : 'hotelId';
    const rows = await this.connection.collection('moderatorassignments')
      .find({ [field]: providerId }, { projection: { moderatorId: 1 }, session }).toArray();
    return unique(rows.map((row) => String(row.moderatorId)));
  }

  /**
   * Read-only: users with a Confirmed booking with this provider. Flights use Person 4's
   * flightbookings (segments[].airlineId); hotels use Person 6's hotelbookings (hotelId).
   */
  private async confirmedCustomerIds(type: ProviderType, providerId: Types.ObjectId, session: ClientSession): Promise<string[]> {
    const userIds: Types.ObjectId[] = type === 'airline'
      ? await this.connection.collection('flightbookings').distinct('userId', { status: BookingStatus.CONFIRMED, 'segments.airlineId': providerId }, { session })
      : await this.connection.collection('hotelbookings').distinct('userId', { status: BookingStatus.CONFIRMED, hotelId: providerId }, { session });
    return unique(userIds.map((id) => id.toString()));
  }
}

function unique(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => /^[a-f\d]{24}$/i.test(id)).map((id) => id.toLowerCase()))];
}
