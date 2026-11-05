import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccountStatus } from '../../common/enums/account-status.enum';
import { User } from '../../users/schemas/user.schema';
import { ItineraryAccountStatusesPort, ItineraryAuthorNamesPort } from '../ports/itinerary-authors.port';

function toObjectIds(userIds: string[]): Types.ObjectId[] {
  return [...new Set(userIds)].filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
}

/**
 * TEMPORARY until `UsersService.getAccountStatuses` (Person 1) is implemented. Same
 * signature and semantics: only existing users are returned, errors propagate. Replace the
 * binding in ItinerariesModule with `useExisting: UsersService`; nothing else changes.
 */
@Injectable()
export class InterimAccountStatusesAdapter implements ItineraryAccountStatusesPort {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  async getAccountStatuses(userIds: string[]): Promise<Map<string, AccountStatus>> {
    const ids = toObjectIds(userIds);
    if (ids.length === 0) return new Map();
    const rows = await this.users.find({ _id: { $in: ids } }, { status: 1 }).lean().exec();
    return new Map(rows.map((row) => [row._id.toString(), row.status]));
  }
}

/**
 * Read-only author names for attribution. The agreed shared method returns statuses only;
 * this stays until UsersService offers a name lookup (see the contract proposal).
 */
@Injectable()
export class UserAuthorNamesAdapter implements ItineraryAuthorNamesPort {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  async getNames(userIds: string[]): Promise<Map<string, string>> {
    const ids = toObjectIds(userIds);
    if (ids.length === 0) return new Map();
    const rows = await this.users.find({ _id: { $in: ids } }, { name: 1 }).lean().exec();
    return new Map(rows.map((row) => [row._id.toString(), row.name]));
  }
}
