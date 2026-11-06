import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request, { Response } from 'supertest';

import { AuthSession } from '../src/auth/schemas/auth-session.schema';
import { UserRole } from '../src/common/enums/user-role.enum';
import { configureApplication } from '../src/configure-application';
import { HotelsModule } from '../src/hotels/hotels.module';
import { ReferenceDataService } from '../src/reference-data/reference-data.service';
import { User, UserDocument } from '../src/users/schemas/user.schema';

function cookiesFrom(response: Response): string {
  const header = response.headers['set-cookie'] as unknown as string[];
  return header.map((cookie) => cookie.split(';')[0]).join('; ');
}

describe('Hotels E2E', { concurrency: false }, () => {
  let replicaSet: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;

  let users: Model<UserDocument>;
  let sessions: Model<AuthSession>;

  let adminCookie: string;
  let moderatorCookie: string;
  let moderatorId: Types.ObjectId;
  let hotelId: string;

  async function login(email: string, role = UserRole.USER): Promise<string> {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Test User', email, password: 'Travel123', termsAccepted: true })
      .expect(201);

    await users.updateOne({ email }, { $set: { role } }).exec();

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Sec-Fetch-Site', 'same-origin')
      .send({ email, password: 'Travel123' })
      .expect(200);

    return cookiesFrom(response);
  }

  function http() {
    return request(app.getHttpServer());
  }

  before(async () => {
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      binary: { downloadDir: resolve(process.cwd(), 'node_modules/.cache/mongodb-binaries') },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          skipProcessEnv: true,
          load: [() => ({ JWT_SECRET: randomBytes(48).toString('hex') })],
        }),
        MongooseModule.forRoot(replicaSet.getUri('hotels')),
        HotelsModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();

    connection = moduleRef.get(getConnectionToken());
    users = moduleRef.get(getModelToken(User.name));
    sessions = moduleRef.get(getModelToken(AuthSession.name));

    await Promise.all([users.init(), sessions.init()]);
    await moduleRef.get(ReferenceDataService).seedSupported();
  }, { timeout: 30 * 60_000 });

  beforeEach(async () => {
    await Promise.all([
      users.deleteMany({}).exec(),
      sessions.deleteMany({}).exec(),
      ...['hotels', 'rooms', 'moderatorassignments'].map((name) => connection.collection(name).deleteMany({})),
    ]);

    adminCookie = await login('admin@example.com', UserRole.ADMIN);
    moderatorCookie = await login('hotel-moderator@example.com', UserRole.HOTEL_MODERATOR);
    const moderator = await users.findOne({ email: 'hotel-moderator@example.com' }).orFail().exec();
    moderatorId = moderator._id as Types.ObjectId;

    const created = await http()
      .post('/api/hotels')
      .set('Cookie', adminCookie)
      .send({ name: 'Nile Grand Hotel', city: 'Cairo', address: '12 Nile Corniche' })
      .expect(201);
    hotelId = created.body._id;

    await connection.collection('moderatorassignments').insertOne({ moderatorId, hotelId: new Types.ObjectId(hotelId) });
  });

  after(async () => {
    try {
      if (app) await app.close();
    } finally {
      if (replicaSet) await replicaSet.stop();
    }
  }, { timeout: 30_000 });

  describe('Create hotel - HTL-01', () => {
    it('registers the route in Swagger and resolves the city against the reference catalog', async () => {
      const doc = (await http().get('/api/docs-json').expect(200)).body;
      assert.ok(doc.paths['/api/hotels'].post);
      assert.ok(doc.paths['/api/hotels/{id}'].get);
      assert.ok(doc.paths['/api/hotels/{id}'].patch);

      const hotel = await connection.collection('hotels').findOne({ _id: new Types.ObjectId(hotelId) });
      assert.equal(hotel!.city, 'Cairo');
      assert.equal(hotel!.countryCode, 'EG');
      assert.equal(hotel!.isActive, true);
      assert.equal(hotel!.checkInTime, '14:00');
      assert.equal(hotel!.checkOutTime, '11:00');
    });

    it('rejects a city outside the official reference catalog', async () => {
      await http()
        .post('/api/hotels')
        .set('Cookie', adminCookie)
        .send({ name: 'Nowhere Hotel', city: 'Atlantis', address: 'Unknown' })
        .expect(400);
    });

    it('requires an admin session', async () => {
      await http().post('/api/hotels').send({ name: 'x', city: 'Cairo', address: 'y' }).expect(401);
      await http()
        .post('/api/hotels')
        .set('Cookie', moderatorCookie)
        .send({ name: 'x', city: 'Cairo', address: 'y' })
        .expect(403);
    });
  });

  describe('View hotel - HTL-02', () => {
    it('shows an active hotel to anyone, including guests', async () => {
      const response = await http().get(`/api/hotels/${hotelId}`).expect(200);
      assert.equal(response.body.name, 'Nile Grand Hotel');
    });

    it('hides a deactivated hotel from guests and other users, but not its own moderator or an admin', async () => {
      await connection.collection('hotels').updateOne({ _id: new Types.ObjectId(hotelId) }, { $set: { isActive: false } });

      await http().get(`/api/hotels/${hotelId}`).expect(404);

      const otherUser = await login('traveler@example.com', UserRole.USER);
      await http().get(`/api/hotels/${hotelId}`).set('Cookie', otherUser).expect(404);

      await http().get(`/api/hotels/${hotelId}`).set('Cookie', moderatorCookie).expect(200);
      await http().get(`/api/hotels/${hotelId}`).set('Cookie', adminCookie).expect(200);
    });

    it('returns 404 for an unknown or malformed id', async () => {
      await http().get(`/api/hotels/${new Types.ObjectId().toString()}`).expect(404);
      await http().get('/api/hotels/not-an-id').expect(404);
    });
  });

  describe('Update own hotel - HTL-01', () => {
    it('updates the assigned moderator\'s own hotel', async () => {
      const response = await http()
        .patch(`/api/hotels/${hotelId}`)
        .set('Cookie', moderatorCookie)
        .send({ name: 'Nile Grand Hotel & Spa', address: '1 Corniche El Nil' })
        .expect(200);

      assert.equal(response.body.name, 'Nile Grand Hotel & Spa');
      assert.equal(response.body.address, '1 Corniche El Nil');
    });

    it('re-resolves the city when it changes', async () => {
      const response = await http()
        .patch(`/api/hotels/${hotelId}`)
        .set('Cookie', moderatorCookie)
        .send({ city: 'Dubai' })
        .expect(200);

      assert.equal(response.body.city, 'Dubai');
      assert.equal(response.body.countryCode, 'AE');
    });

    it('rejects a moderator with no hotel assignment at all', async () => {
      const otherModerator = await login('other-hotel-moderator@example.com', UserRole.HOTEL_MODERATOR);
      await http().patch(`/api/hotels/${hotelId}`).set('Cookie', otherModerator).send({ name: 'Hijacked' }).expect(403);
    });

    it('rejects another moderator editing a hotel that is not their own assignment', async () => {
      const otherModerator = await login('other-hotel-moderator@example.com', UserRole.HOTEL_MODERATOR);
      const other = await users.findOne({ email: 'other-hotel-moderator@example.com' }).orFail().exec();
      const otherHotel = new Types.ObjectId();
      await connection.collection('moderatorassignments').insertOne({ moderatorId: other._id, hotelId: otherHotel });
      await http().patch(`/api/hotels/${hotelId}`).set('Cookie', otherModerator).send({ name: 'Hijacked' }).expect(404);
    });

    it('requires an authenticated hotel moderator', async () => {
      await http().patch(`/api/hotels/${hotelId}`).send({ name: 'x' }).expect(401);
      const ordinaryUser = await login('user@example.com');
      await http().patch(`/api/hotels/${hotelId}`).set('Cookie', ordinaryUser).send({ name: 'x' }).expect(403);
    });

    it('rejects an empty update', async () => {
      await http().patch(`/api/hotels/${hotelId}`).set('Cookie', moderatorCookie).send({}).expect(400);
    });
  });

  describe('Rooms - HTL-03, HTL-05, HTL-06', () => {
    async function createRoom(overrides: Partial<{ name: string; capacity: number; pricePerNight: number }> = {}) {
      const response = await http()
        .post(`/api/hotels/${hotelId}/rooms`)
        .set('Cookie', moderatorCookie)
        .send({ name: 'Deluxe King', capacity: 2, pricePerNight: 15000, ...overrides })
        .expect(201);
      return response.body;
    }

    it('creates a room for the moderator\'s own hotel', async () => {
      const room = await createRoom();
      assert.equal(room.hotelId, hotelId);
      assert.equal(room.name, 'Deluxe King');
      assert.equal(room.capacity, 2);
      assert.equal(room.pricePerNight, 15000);
      assert.equal(room.isActive, true);

      const doc = (await http().get('/api/docs-json').expect(200)).body;
      assert.ok(doc.paths['/api/hotels/{id}/rooms'].post);
      assert.ok(doc.paths['/api/hotels/{id}/rooms/{roomId}'].patch);
      assert.ok(doc.paths['/api/hotels/{id}/rooms/{roomId}'].delete);
    });

    it('rejects room creation for another moderator\'s hotel', async () => {
      const otherModerator = await login('other-hotel-moderator@example.com', UserRole.HOTEL_MODERATOR);
      await http()
        .post(`/api/hotels/${hotelId}/rooms`)
        .set('Cookie', otherModerator)
        .send({ name: 'Hijacked Room', capacity: 2, pricePerNight: 1000 })
        .expect(403);
    });

    it('requires an authenticated hotel moderator to create a room', async () => {
      await http().post(`/api/hotels/${hotelId}/rooms`).send({ name: 'x', capacity: 1, pricePerNight: 1 }).expect(401);
      const ordinaryUser = await login('user@example.com');
      await http()
        .post(`/api/hotels/${hotelId}/rooms`)
        .set('Cookie', ordinaryUser)
        .send({ name: 'x', capacity: 1, pricePerNight: 1 })
        .expect(403);
    });

    it('updates a room of the moderator\'s own hotel', async () => {
      const room = await createRoom();
      const response = await http()
        .patch(`/api/hotels/${hotelId}/rooms/${room._id}`)
        .set('Cookie', moderatorCookie)
        .send({ capacity: 4, pricePerNight: 18000 })
        .expect(200);

      assert.equal(response.body.capacity, 4);
      assert.equal(response.body.pricePerNight, 18000);
      assert.equal(response.body.name, 'Deluxe King');
    });

    it('rejects an empty room update', async () => {
      const room = await createRoom();
      await http().patch(`/api/hotels/${hotelId}/rooms/${room._id}`).set('Cookie', moderatorCookie).send({}).expect(400);
    });

    it('rejects editing a room that does not belong to this hotel', async () => {
      const otherModerator = await login('other-hotel-moderator@example.com', UserRole.HOTEL_MODERATOR);
      const other = await users.findOne({ email: 'other-hotel-moderator@example.com' }).orFail().exec();
      const otherHotelId = new Types.ObjectId();
      await connection.collection('hotels').insertOne({
        _id: otherHotelId, name: 'Other Hotel', city: 'Dubai', countryCode: 'AE', address: 'Marina',
        isActive: true, checkInTime: '14:00', checkOutTime: '11:00', cancellationTiers: [],
      });
      await connection.collection('moderatorassignments').insertOne({ moderatorId: other._id, hotelId: otherHotelId });

      const room = await createRoom();
      await http()
        .patch(`/api/hotels/${otherHotelId.toString()}/rooms/${room._id}`)
        .set('Cookie', otherModerator)
        .send({ capacity: 9 })
        .expect(404);
    });

    it('deactivates a room instead of deleting it', async () => {
      const room = await createRoom();
      await http().delete(`/api/hotels/${hotelId}/rooms/${room._id}`).set('Cookie', moderatorCookie).expect(204);

      const stored = await connection.collection('rooms').findOne({ _id: new Types.ObjectId(room._id) });
      assert.ok(stored, 'the room document is kept, not removed');
      assert.equal(stored!.isActive, false);
    });

    it('returns 404 for a room id that does not exist', async () => {
      await http()
        .patch(`/api/hotels/${hotelId}/rooms/${new Types.ObjectId().toString()}`)
        .set('Cookie', moderatorCookie)
        .send({ capacity: 3 })
        .expect(404);
      await http()
        .delete(`/api/hotels/${hotelId}/rooms/${new Types.ObjectId().toString()}`)
        .set('Cookie', moderatorCookie)
        .expect(404);
    });
  });
});
