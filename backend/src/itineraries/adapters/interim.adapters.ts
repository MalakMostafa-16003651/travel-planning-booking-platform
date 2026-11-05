import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import { ItineraryAuthor, ItineraryAuthorsPort } from '../ports/itinerary-authors.port';

/**
 * TEMPORARY until UsersService exposes the agreed batch lookup. Reads only _id, name and
 * status. Replace the binding in ItinerariesModule; nothing else changes.
 */
@Injectable()
export class InterimAuthorsAdapter implements ItineraryAuthorsPort {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  async getAuthors(userIds: string[]): Promise<Map<string, ItineraryAuthor>> {
    const ids = [...new Set(userIds)].filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    if (ids.length === 0) return new Map();
    const rows = await this.users.find({ _id: { $in: ids } }, { name: 1, status: 1 }).lean().exec();
    return new Map(rows.map((row) => [row._id.toString(), { name: row.name, status: row.status }]));
  }
}
