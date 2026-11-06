import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CITY_SEEDS, COUNTRY_SEEDS } from './reference-seeds';
import { City, Country } from './reference.schemas';

@Injectable()
export class ReferenceDataService implements OnModuleInit {
  constructor(@InjectModel(Country.name) private readonly countries: Model<Country>,
    @InjectModel(City.name) private readonly cities: Model<City>) {}

  async onModuleInit(): Promise<void> { await Promise.all([this.countries.init(), this.cities.init()]); }

  listCountries(): Promise<Country[]> {
    return this.countries.find({ code: { $in: COUNTRY_SEEDS.map(({ code }) => code) } }).sort({ name: 1 }).lean().exec();
  }

  listCities(): Promise<City[]> {
    return this.cities.find({ cityId: { $in: CITY_SEEDS.map(({ cityId }) => cityId) } }).sort({ name: 1 }).lean().exec();
  }

  async assertCountries(codes: string[]): Promise<void> {
    const supported = new Set((await this.listCountries()).map(({ code }) => code));
    if (codes.some((code) => !supported.has(code))) throw new BadRequestException({
      message: 'Validation failed', errors: { countries: ['Choose countries from the official reference catalog'] },
    });
  }

  async resolveCity(name: string, countryCode?: string): Promise<City> {
    const city = (await this.listCities()).find((row) =>
      (row.name.toLowerCase() === name.trim().toLowerCase() || row.cityId === name.trim().toLowerCase())
      && (countryCode === undefined || row.countryCode === countryCode));
    if (!city) throw new BadRequestException({ message: 'Validation failed',
      errors: { city: ['Choose a city and matching country from the official reference catalog'] } });
    return city;
  }

  async matchingCountryCodes(keyword: string): Promise<string[]> {
    const text = keyword.toLowerCase();
    return (await this.listCountries()).filter((row) =>
      row.name.toLowerCase().includes(text) || row.code.toLowerCase().includes(text)).map(({ code }) => code);
  }

  async seedSupported(): Promise<{ countries: number; cities: number }> {
    await this.onModuleInit();
    const insertedAt = new Date();
    for (const row of COUNTRY_SEEDS) {
      const result = await this.countries.updateOne({ code: row.code },
        { $setOnInsert: { ...row, createdAt: insertedAt, updatedAt: insertedAt } },
        { upsert: true, timestamps: false, runValidators: true }).exec();
      if (!result.acknowledged || (result.matchedCount !== 1 && result.upsertedCount !== 1)) throw new Error('Country seed not confirmed');
    }
    for (const row of CITY_SEEDS) {
      const result = await this.cities.updateOne({ cityId: row.cityId },
        { $setOnInsert: { ...row, createdAt: insertedAt, updatedAt: insertedAt } },
        { upsert: true, timestamps: false, runValidators: true }).exec();
      if (!result.acknowledged || (result.matchedCount !== 1 && result.upsertedCount !== 1)) throw new Error('City seed not confirmed');
    }
    return { countries: COUNTRY_SEEDS.length, cities: CITY_SEEDS.length };
  }
}
