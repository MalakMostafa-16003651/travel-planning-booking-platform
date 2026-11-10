import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { Airline, AirlineDocument } from '../airlines/schemas/airline.schema';
import { AuditAction, AuditTargetType } from '../audit-logs/audit-log.enums';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PasswordService } from '../auth/password.service';
import { AccountStatus } from '../common/enums/account-status.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { ModeratorDto } from './dto/moderator-response.dto';
import { ModeratorAssignment, ModeratorAssignmentDocument } from './schemas/moderator-assignment.schema';

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

@Injectable()
export class AdminModeratorsService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(ModeratorAssignment.name) private readonly assignments: Model<ModeratorAssignmentDocument>,
    @InjectModel(Airline.name) private readonly airlines: Model<AirlineDocument>,
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly passwords: PasswordService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * ACC-13: creates a hotel or airline moderator linked to exactly one provider, with an
   * admin-set temporary password (Person 1's mustChangePassword flow forces a change at
   * first login). The account and its assignment are created in one transaction, so a
   * moderator never exists without an assignment.
   */
  async create(adminId: string, input: CreateModeratorDto): Promise<ModeratorDto> {
    const airline = input.role === UserRole.AIRLINE_MODERATOR;
    const providerId = new Types.ObjectId(input.providerId);
    const provider = airline
      ? await this.airlines.findById(providerId, { name: 1 }).lean().exec()
      : await this.hotels.findById(providerId, { name: 1 }).lean().exec();
    if (!provider) {
      throw new NotFoundException({
        message: `${airline ? 'Airline' : 'Hotel'} not found`,
        errors: { providerId: [`No ${airline ? 'airline' : 'hotel'} has this ID`] },
      });
    }

    // Person 1's shared salted scrypt hasher, so every password is stored the same way.
    const passwordHash = await this.passwords.hash(input.temporaryPassword);
    const session = await this.connection.startSession();
    let moderator: UserDocument;
    try {
      moderator = await session.withTransaction(async () => {
        const [created] = await this.users.create([{
          name: input.name,
          email: input.email,
          passwordHash,
          role: input.role,
          status: AccountStatus.ACTIVE,
          mustChangePassword: true,
          // Required by the shared User schema. Moderators are onboarded by an administrator
          // rather than self-registering, so this records when the account was set up.
          termsAcceptedAt: new Date(),
        }], { session });
        await this.assignments.create([{
          moderatorId: created._id,
          ...(airline ? { airlineId: providerId } : { hotelId: providerId }),
        }], { session });
        await this.auditLogs.log({
          adminId,
          action: AuditAction.MODERATOR_CREATED,
          targetType: AuditTargetType.USER,
          targetId: created._id.toString(),
          details: `${input.role} for ${airline ? 'airline' : 'hotel'} ${provider.name} (${input.providerId})`,
        }, session);
        return created;
      });
    } catch (error: unknown) {
      if (isDuplicateKey(error)) {
        throw new ConflictException({ message: 'Email is already registered', errors: { email: ['Email is already registered'] } });
      }
      throw error;
    } finally {
      await session.endSession();
    }

    return {
      userId: moderator._id.toString(),
      name: moderator.name,
      email: moderator.email,
      role: input.role,
      status: moderator.status,
      providerType: airline ? 'airline' : 'hotel',
      providerId: input.providerId,
      providerName: provider.name,
      mustChangePassword: true,
      createdAt: moderator.createdAt,
    };
  }
}
