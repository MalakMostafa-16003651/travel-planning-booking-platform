import { INestApplicationContext, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { disconnect } from 'mongoose';
import { SeedDatabaseModule } from './seed-database.module';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { ReferenceDataService } from '../reference-data/reference-data.service';

@Module({ imports: [SeedDatabaseModule, ReferenceDataModule] })
class ReferenceSeedModule {}

async function seedReferences(): Promise<void> {
  let app: INestApplicationContext | undefined;
  try {
    app = await NestFactory.createApplicationContext(ReferenceSeedModule, { logger: false, abortOnError: false });
    const counts = await app.get(ReferenceDataService).seedSupported();
    await app.close(); app = undefined;
    process.stdout.write(`Country/city reference seed completed: ${counts.countries} countries and ${counts.cities} cities available.\n`);
  } finally {
    if (app) await app.close();
    await disconnect();
  }
}
void seedReferences().catch(() => {
  process.stderr.write('Reference seed did not finish cleanly. Check MongoDB configuration/connectivity, then retry.\n');
  process.exitCode = 1;
});
