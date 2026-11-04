import { INestApplicationContext, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { disconnect } from 'mongoose';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { PasswordService } from '../auth/password.service';
import { AdminSeedService } from '../users/admin-seed.service';
import { User, UserSchema } from '../users/schemas/user.schema';
import { SeedDatabaseModule } from './seed-database.module';

@Module({
  imports: [SeedDatabaseModule, MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  providers: [PasswordService, AdminSeedService],
})
class AdminSeedModule {}

async function readCredentials(): Promise<unknown> {
  if (process.argv.includes('--stdin-json')) {
    let text = '';
    for await (const chunk of process.stdin) {
      text += chunk.toString();
      if (Buffer.byteLength(text) > 32_768) throw new Error('Input too large');
    }
    return JSON.parse(text);
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('An interactive terminal is required');
  let hidden = false;
  const output = new Writable({ write(chunk, _encoding, done) {
    if (!hidden) process.stdout.write(chunk);
    done();
  } });
  const terminal = createInterface({ input: process.stdin, output, terminal: true });
  try {
    const name = await terminal.question('Administrator name: ');
    const email = await terminal.question('Administrator email: ');
    process.stdout.write('Password (hidden): ');
    hidden = true;
    const password = await terminal.question('');
    hidden = false;
    process.stdout.write('\n');
    const consent = await terminal.question('Accept the project terms/privacy policy for this account? Type yes: ');
    return { name, email, password, termsAccepted: consent.trim().toLowerCase() === 'yes' };
  } finally {
    hidden = false;
    terminal.close();
    output.end();
  }
}

async function seedAdmin(): Promise<void> {
  const input = await readCredentials();
  let app: INestApplicationContext | undefined;
  try {
    app = await NestFactory.createApplicationContext(AdminSeedModule, { logger: false, abortOnError: false });
    await app.get(AdminSeedService).seed(input);
    await app.close();
    app = undefined;
    process.stdout.write('Administrator seed completed; existing administrator data is preserved.\n');
  } finally {
    if (app) await app.close();
    await disconnect();
  }
}

void seedAdmin().catch(() => {
  process.stderr.write('Administrator seed failed. Check input, account collision, or MongoDB configuration. No existing account is promoted or reset.\n');
  process.exitCode = 1;
});
