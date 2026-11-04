import { INestApplicationContext, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { disconnect } from 'mongoose';
import { resolve } from 'node:path';
import { CurrenciesModule } from '../currencies/currencies.module';
import { CurrenciesService } from '../currencies/currencies.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(__dirname, '../../../.env'),
      // Isolated tests supply their own URI and never load a local secret file.
      ignoreEnvFile: process.argv.includes('--no-env-file'),
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const uri = config.get<unknown>('MONGODB_URI');
        if (typeof uri !== 'string' || !/^mongodb(?:\+srv)?:\/\/\S+$/.test(uri)) {
          throw new Error('A valid MONGODB_URI is required');
        }
        return { uri, serverSelectionTimeoutMS: 10_000, retryAttempts: 0 };
      },
    }),
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
