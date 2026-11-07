import { INestApplicationContext, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { disconnect } from 'mongoose';
import { SeedDatabaseModule } from './seed-database.module';
import { AirportSeedModule } from '../airports/airport-seed.module';
import { AirportsService } from '../airports/airports.service';

@Module({ imports: [SeedDatabaseModule, AirportSeedModule] })
class AirportSeedApplicationModule {}

async function seedAirports(): Promise<void> {
  let app: INestApplicationContext | undefined;
  try {
    app = await NestFactory.createApplicationContext(AirportSeedApplicationModule, { logger: false, abortOnError: false });
    const count = await app.get(AirportsService).seedPredefined();
    await app.close(); app = undefined;
    process.stdout.write(`Airport reference seed completed: ${count} required airports available.\n`);
  } finally {
    if (app) await app.close();
    await disconnect();
  }
}

void seedAirports().catch(() => {
  process.stderr.write('Airport seed did not finish cleanly. Check MongoDB configuration/connectivity, then retry.\n');
  process.exitCode = 1;
});
