import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { resolve } from 'node:path';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolve(__dirname, '../../../.env'),
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
  ],
})
export class SeedDatabaseModule {}
