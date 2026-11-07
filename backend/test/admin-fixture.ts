import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { INestApplication, Type } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model } from 'mongoose';
import request, { Response } from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { UserRole } from '../src/common/enums/user-role.enum';
import { configureApplication } from '../src/configure-application';
import { User, UserDocument } from '../src/users/schemas/user.schema';

export const PASSWORD = 'Travel123';

export type Session = { cookie: string; userId: string };

function cookiesFrom(response: Response): string {
  const header = response.headers['set-cookie'] as unknown as string[];
  return header.map((cookie) => cookie.split(';')[0]).join('; ');
}

/**
 * Person 2's test fixture: the real Auth module plus the admin modules under test,
 * on an isolated in-memory MongoDB. Never reads .env or touches Atlas.
 */
export class AdminFixture {
  replicaSet!: MongoMemoryReplSet;
  app!: INestApplication;
  connection!: Connection;
  users!: Model<UserDocument>;

  constructor(private readonly modules: Type<unknown>[]) {}

  async start(dbName: string) {
    this.replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      binary: { downloadDir: resolve(process.cwd(), 'node_modules/.cache/mongodb-binaries') },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true, load: [() => ({ JWT_SECRET: randomBytes(48).toString('hex') })] }),
        MongooseModule.forRoot(this.replicaSet.getUri(dbName)),
        AuthModule,
        ...this.modules,
      ],
    }).compile();
    this.app = moduleRef.createNestApplication();
    configureApplication(this.app);
    await this.app.init();
    this.connection = moduleRef.get(getConnectionToken());
    this.users = moduleRef.get(getModelToken(User.name));
    await Promise.all(Object.values(this.connection.models).map((model) => model.init()));
  }

  async stop() {
    await this.app?.close();
    await this.replicaSet?.stop();
  }

  async reset() {
    const collections = await this.connection.db!.collections();
    await Promise.all(collections.map((collection) => collection.deleteMany({})));
  }

  http() {
    return request(this.app.getHttpServer());
  }

  /** Registers and logs in through Person 1's real endpoints, then sets the role. */
  async login(email: string, role = UserRole.USER, name = 'Test User'): Promise<Session> {
    await this.http().post('/api/auth/register').send({ name, email, password: PASSWORD, termsAccepted: true }).expect(201);
    await this.users.updateOne({ email }, { $set: { role } }).exec();
    const response = await this.http().post('/api/auth/login').set('Sec-Fetch-Site', 'same-origin').send({ email, password: PASSWORD }).expect(200);
    return { cookie: cookiesFrom(response), userId: response.body.userId as string };
  }
}
