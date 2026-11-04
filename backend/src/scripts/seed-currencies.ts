import { INestApplicationContext, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { disconnect } from 'mongoose';
import { SeedDatabaseModule } from './seed-database.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { CurrenciesService } from '../currencies/currencies.service';

@Module({
  imports: [
    SeedDatabaseModule,
    CurrenciesModule,
  ],
})
class CurrencySeedModule {}

async function seedCurrencies(): Promise<void> {
  let app: INestApplicationContext | undefined;
  try {
    // No HTTP server, authentication setup or booking maintenance is started.
    app = await NestFactory.createApplicationContext(CurrencySeedModule, { logger: false, abortOnError: false });
    const count = await app.get(CurrenciesService).seedSupported();
    await app.close();
    app = undefined;
    process.stdout.write(`Currency reference seed completed: ${count} required codes available.\n`);
  } finally {
    if (app) await app.close();
    // This standalone CLI owns its connections, including failed startup paths.
    await disconnect();
  }
}

void seedCurrencies().catch(() => {
  // Never print driver errors, connection strings, credentials or environment values.
  process.stderr.write('Currency seed did not finish cleanly. Check MongoDB configuration/connectivity, then retry.\n');
  process.exitCode = 1;
});
