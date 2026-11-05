import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AIRPORT_SEEDS } from './airport-seeds';
import { Airport } from './schemas/airport.schema';

@Injectable()
export class AirportsService implements OnModuleInit {
  constructor(@InjectModel(Airport.name) private readonly airports: Model<Airport>) {}

  async onModuleInit(): Promise<void> { await this.airports.init(); }

  list(): Promise<Airport[]> { return this.airports.find().sort({ code: 1 }).exec(); }

  async findByCode(code: string): Promise<Airport | null> {
    if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) return null;
    return this.airports.findOne({ code }).exec();
  }

  async findById(id: string): Promise<Airport | null> { return this.airports.findById(id).exec(); }

  async seedPredefined(): Promise<number> {
    await this.airports.init();
    let count = 0;
    const now = new Date();
    for (const airport of AIRPORT_SEEDS) {
      const result = await this.airports.updateOne(
        { code: airport.code },
        { $setOnInsert: { ...airport, createdAt: now, updatedAt: now } },
        { upsert: true, timestamps: false, runValidators: true },
      ).exec();
      if (!result.acknowledged || (result.matchedCount !== 1 && result.upsertedCount !== 1)) throw new Error('Airport seed write was not confirmed');
      count++;
    }
    return count;
  }
}
