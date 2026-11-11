import { configureTestBookableRoom } from './hotel-test-data';
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

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);

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
  let roomSequence = 0;

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
    roomSequence = 0;
    await Promise.all([
      users.deleteMany({}).exec(),
      sessions.deleteMany({}).exec(),
      ...['hotels', 'rooms', 'roomavailabilities', 'moderatorassignments', 'hotelbookings', 'auditlogs'].map((name) => connection.collection(name).deleteMany({})),
    ]);

    adminCookie = await login('admin@example.com', UserRole.ADMIN);
    moderatorCookie = await login('hotel-moderator@example.com', UserRole.HOTEL_MODERATOR);
    const moderator = await users.findOne({ email: 'hotel-moderator@example.com' }).orFail().exec();
    moderatorId = moderator._id as Types.ObjectId;

    const created = await http()
      .post('/api/hotels')
      .set('Cookie', adminCookie)
      .send({ starClass: 4, amenities: [], name: 'Nile Grand Hotel', city: 'Cairo', address: '12 Nile Corniche' })
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

    it('records a GEN-07 audit log entry for the admin who created the hotel', async () => {
      const admin = await users.findOne({ email: 'admin@example.com' }).orFail().exec();
      const entry = await connection.collection('auditlogs').findOne({ targetId: new Types.ObjectId(hotelId) });
      assert.ok(entry, 'an audit log entry was written for this hotel');
      assert.equal(entry!.action, 'HOTEL_CREATED');
      assert.equal(entry!.targetType, 'HOTEL');
      assert.equal(entry!.adminId.toString(), admin._id.toString());
    });

    it('rejects a city outside the official reference catalog', async () => {
      await http()
        .post('/api/hotels')
        .set('Cookie', adminCookie)
        .send({ starClass: 4, amenities: [], name: 'Nowhere Hotel', city: 'Atlantis', address: 'Unknown' })
        .expect(400);
    });

    it('requires an admin session', async () => {
      await http().post('/api/hotels').send({ starClass: 4, amenities: [], name: 'x', city: 'Cairo', address: 'y' }).expect(401);
      await http()
        .post('/api/hotels')
        .set('Cookie', moderatorCookie)
        .send({ starClass: 4, amenities: [], name: 'x', city: 'Cairo', address: 'y' })
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
        .send({ type: 'Standard', beds: 1, name: 'Deluxe King', capacity: 2, pricePerNight: 15000, ...overrides })
        .expect(201);
      await configureTestBookableRoom(connection,response.body._id,hotelId);
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
        .send({ type: 'Standard', beds: 1, name: 'Hijacked Room', capacity: 2, pricePerNight: 1000 })
        .expect(403);
    });

    it('requires an authenticated hotel moderator to create a room', async () => {
      await http().post(`/api/hotels/${hotelId}/rooms`).send({ type: 'Standard', beds: 1, name: 'x', capacity: 1, pricePerNight: 1 }).expect(401);
      const ordinaryUser = await login('user@example.com');
      await http()
        .post(`/api/hotels/${hotelId}/rooms`)
        .set('Cookie', ordinaryUser)
        .send({ type: 'Standard', beds: 1, name: 'x', capacity: 1, pricePerNight: 1 })
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

    it('refuses to deactivate a room with an active reservation (HTL-06, Osama\'s roomHasActiveReservations)', async () => {
      const room = await createRoom();
      const guest = await login('guest@example.com');
      await http()
        .post('/api/hotel-bookings')
        .set('Cookie', guest)
        .send({ hotelId, checkIn: '2030-06-01', checkOut: '2030-06-05', rooms: [{ roomId: room._id, adults: 1, childrenAges: [] }] })
        .expect(201);

      await http().delete(`/api/hotels/${hotelId}/rooms/${room._id}`).set('Cookie', moderatorCookie).expect(409);

      const stored = await connection.collection('rooms').findOne({ _id: new Types.ObjectId(room._id) });
      assert.equal(stored!.isActive, true, 'the room is not deactivated while the hold is active');
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

  describe('Room availability - HTL-04, HTL-05, HTL-06, HTL-08', () => {
    async function createRoom() {
      const response = await http()
        .post(`/api/hotels/${hotelId}/rooms`)
        .set('Cookie', moderatorCookie)
        .send({ type: 'Standard', beds: 1, name: 'Deluxe King', capacity: 2, pricePerNight: 15000 })
        .expect(201);
      await configureTestBookableRoom(connection,response.body._id,hotelId);
      return response.body._id as string;
    }

    it('blocks a date range and registers the route in Swagger', async () => {
      const roomId = await createRoom();
      const response = await http()
        .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', moderatorCookie)
        .send({ startDate: '2026-12-20', endDate: '2026-12-27', reason: 'Maintenance' })
        .expect(201);

      assert.equal(response.body.roomId, roomId);
      assert.equal(response.body.blockedRanges.length, 1);
      assert.equal(response.body.blockedRanges[0].startDate, '2026-12-20');
      assert.equal(response.body.blockedRanges[0].endDate, '2026-12-27');
      assert.equal(response.body.blockedRanges[0].reason, 'Maintenance');

      const doc = (await http().get('/api/docs-json').expect(200)).body;
      assert.ok(doc.paths['/api/hotels/{id}/rooms/{roomId}/availability'].post);
      assert.ok(doc.paths['/api/hotels/{id}/rooms/{roomId}/availability'].patch);
      assert.ok(doc.paths['/api/hotels/{id}/availability'].get);
    });

    it('rejects an end date on or before the start date', async () => {
      const roomId = await createRoom();
      await http()
        .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', moderatorCookie)
        .send({ startDate: '2026-12-27', endDate: '2026-12-20' })
        .expect(400);
    });

    it('rejects a new blocked range that overlaps an existing one', async () => {
      const roomId = await createRoom();
      await http()
        .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', moderatorCookie)
        .send({ startDate: '2026-12-20', endDate: '2026-12-27' })
        .expect(201);

      await http()
        .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', moderatorCookie)
        .send({ startDate: '2026-12-25', endDate: '2026-12-30' })
        .expect(409);

      // Touching the existing range's checkout date does not overlap it (half-open ranges).
      await http()
        .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', moderatorCookie)
        .send({ startDate: '2026-12-27', endDate: '2026-12-30' })
        .expect(201);
    });

    it('edits a blocked range\'s dates', async () => {
      const roomId = await createRoom();
      const created = await http()
        .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', moderatorCookie)
        .send({ startDate: '2026-12-20', endDate: '2026-12-27' })
        .expect(201);
      const blockedRangeId = created.body.blockedRanges[0]._id;

      const response = await http()
        .patch(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', moderatorCookie)
        .send({ blockedRangeId, startDate: '2026-12-21', endDate: '2026-12-28' })
        .expect(200);

      assert.equal(response.body.blockedRanges.length, 1);
      assert.equal(response.body.blockedRanges[0].startDate, '2026-12-21');
      assert.equal(response.body.blockedRanges[0].endDate, '2026-12-28');
    });

    it('rejects editing a blocked range onto dates that overlap another one', async () => {
      const roomId = await createRoom();
      const first = await http()
        .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', moderatorCookie)
        .send({ startDate: '2026-12-01', endDate: '2026-12-05' })
        .expect(201);
      await http()
        .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', moderatorCookie)
        .send({ startDate: '2026-12-10', endDate: '2026-12-15' })
        .expect(201);

      const blockedRangeId = first.body.blockedRanges[0]._id;
      await http()
        .patch(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', moderatorCookie)
        .send({ blockedRangeId, startDate: '2026-12-04', endDate: '2026-12-11' })
        .expect(409);
    });

    it('unblocks (removes) a blocked range', async () => {
      const roomId = await createRoom();
      const created = await http()
        .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', moderatorCookie)
        .send({ startDate: '2026-12-20', endDate: '2026-12-27' })
        .expect(201);
      const blockedRangeId = created.body.blockedRanges[0]._id;

      const response = await http()
        .patch(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', moderatorCookie)
        .send({ blockedRangeId, remove: true })
        .expect(200);

      assert.equal(response.body.blockedRanges.length, 0);

      // The dates are free again.
      await http()
        .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', moderatorCookie)
        .send({ startDate: '2026-12-20', endDate: '2026-12-27' })
        .expect(201);
    });

    it('rejects remove combined with new dates, and an unknown blockedRangeId', async () => {
      const roomId = await createRoom();
      const created = await http()
        .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', moderatorCookie)
        .send({ startDate: '2026-12-20', endDate: '2026-12-27' })
        .expect(201);
      const blockedRangeId = created.body.blockedRanges[0]._id;

      await http()
        .patch(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', moderatorCookie)
        .send({ blockedRangeId, remove: true, startDate: '2026-12-21', endDate: '2026-12-28' })
        .expect(400);

      await http()
        .patch(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', moderatorCookie)
        .send({ blockedRangeId: new Types.ObjectId().toString(), remove: true })
        .expect(404);
    });

    it('rejects a moderator blocking dates for a room that is not theirs', async () => {
      const roomId = await createRoom();
      const otherModerator = await login('other-hotel-moderator@example.com', UserRole.HOTEL_MODERATOR);
      await http()
        .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', otherModerator)
        .send({ startDate: '2026-12-20', endDate: '2026-12-27' })
        .expect(403);
    });

    it('lists every active room\'s availability for the hotel, optionally windowed', async () => {
      const blockedRoomId = await createRoom();
      const freeRoomResponse = await http()
        .post(`/api/hotels/${hotelId}/rooms`)
        .set('Cookie', moderatorCookie)
        .send({ type: 'Standard', beds: 1, name: 'Standard Twin', capacity: 2, pricePerNight: 9000 })
        .expect(201);
      const freeRoomId = freeRoomResponse.body._id as string;

      await http()
        .post(`/api/hotels/${hotelId}/rooms/${blockedRoomId}/availability`)
        .set('Cookie', moderatorCookie)
        .send({ startDate: '2026-12-20', endDate: '2026-12-27' })
        .expect(201);

      const full = await http().get(`/api/hotels/${hotelId}/availability?from=2026-12-20&to=2026-12-27`).set('Cookie', moderatorCookie).expect(200);
      assert.equal(full.body.items.length, 2);
      const blockedEntry = full.body.items.find((entry: { roomId: string }) => entry.roomId === blockedRoomId);
      const freeEntry = full.body.items.find((entry: { roomId: string }) => entry.roomId === freeRoomId);
      assert.equal(blockedEntry.blockedRanges.length, 1);
      assert.equal(freeEntry.blockedRanges.length, 0);

      const outsideWindow = await http()
        .get(`/api/hotels/${hotelId}/availability?from=2027-01-01&to=2027-01-10`)
        .set('Cookie', moderatorCookie)
        .expect(200);
      const blockedEntryOutside = outsideWindow.body.items.find((entry: { roomId: string }) => entry.roomId === blockedRoomId);
      assert.equal(blockedEntryOutside.blockedRanges.length, 0);

      const insideWindow = await http()
        .get(`/api/hotels/${hotelId}/availability?from=2026-12-22&to=2026-12-23`)
        .set('Cookie', moderatorCookie)
        .expect(200);
      const blockedEntryInside = insideWindow.body.items.find((entry: { roomId: string }) => entry.roomId === blockedRoomId);
      assert.equal(blockedEntryInside.blockedRanges.length, 1);
    });

    it('requires an authenticated hotel moderator to view hotel availability', async () => {
      await http().get(`/api/hotels/${hotelId}/availability`).expect(401);
      const ordinaryUser = await login('user@example.com');
      await http().get(`/api/hotels/${hotelId}/availability`).set('Cookie', ordinaryUser).expect(403);
    });
  });

  describe('Hotel policies - HTL-09, HTL-10', () => {
    it('updates check-in/check-out times and registers the route in Swagger', async () => {
      const response = await http()
        .put(`/api/hotels/${hotelId}/policies`)
        .set('Cookie', moderatorCookie)
        .send({ checkInTime: '15:00', checkOutTime: '10:00' })
        .expect(200);

      assert.equal(response.body.checkInTime, '15:00');
      assert.equal(response.body.checkOutTime, '10:00');

      const doc = (await http().get('/api/docs-json').expect(200)).body;
      assert.ok(doc.paths['/api/hotels/{id}/policies'].put);
    });

    it('updates cancellation tiers, sorted by days before check-in descending', async () => {
      const response = await http()
        .put(`/api/hotels/${hotelId}/policies`)
        .set('Cookie', moderatorCookie)
        .send({
          cancellationTiers: [
            { daysBeforeCheckIn: 1, refundPercentage: 0 },
            { daysBeforeCheckIn: 14, refundPercentage: 100 },
            { daysBeforeCheckIn: 7, refundPercentage: 50 },
          ],
        })
        .expect(200);

      assert.deepEqual(
        response.body.cancellationTiers.map((tier: { daysBeforeCheckIn: number }) => tier.daysBeforeCheckIn),
        [14, 7, 1],
      );
    });

    it('rejects duplicate cancellation tier thresholds', async () => {
      await http()
        .put(`/api/hotels/${hotelId}/policies`)
        .set('Cookie', moderatorCookie)
        .send({
          cancellationTiers: [
            { daysBeforeCheckIn: 7, refundPercentage: 50 },
            { daysBeforeCheckIn: 7, refundPercentage: 100 },
          ],
        })
        .expect(400);
    });

    it('rejects a malformed time', async () => {
      await http()
        .put(`/api/hotels/${hotelId}/policies`)
        .set('Cookie', moderatorCookie)
        .send({ checkInTime: '27:00' })
        .expect(400);
    });

    it('rejects an empty policies update', async () => {
      await http().put(`/api/hotels/${hotelId}/policies`).set('Cookie', moderatorCookie).send({}).expect(400);
    });

    it('rejects updating policies for a hotel that is not the caller\'s own', async () => {
      const otherModerator = await login('other-hotel-moderator@example.com', UserRole.HOTEL_MODERATOR);
      await http()
        .put(`/api/hotels/${hotelId}/policies`)
        .set('Cookie', otherModerator)
        .send({ checkInTime: '15:00' })
        .expect(403);
    });

    it('requires an authenticated hotel moderator', async () => {
      await http().put(`/api/hotels/${hotelId}/policies`).send({ checkInTime: '15:00' }).expect(401);
      const ordinaryUser = await login('user@example.com');
      await http().put(`/api/hotels/${hotelId}/policies`).set('Cookie', ordinaryUser).send({ checkInTime: '15:00' }).expect(403);
    });
  });

  describe('Hotel search - HTL-11, HTL-12', () => {
    async function createHotelWithModerator(overrides: Partial<{ name: string; city: string }> = {}, moderatorEmail: string) {
      const created = await http()
        .post('/api/hotels')
        .set('Cookie', adminCookie)
        .send({ starClass: 4, amenities: [], name: 'Second Hotel', city: 'Cairo', address: 'Zamalek', ...overrides })
        .expect(201);
      const cookie = await login(moderatorEmail, UserRole.HOTEL_MODERATOR);
      const moderator = await users.findOne({ email: moderatorEmail }).orFail().exec();
      await connection.collection('moderatorassignments').insertOne({ moderatorId: moderator._id, hotelId: new Types.ObjectId(created.body._id) });
      return { hotelId: created.body._id as string, cookie };
    }

    async function addRoom(cookie: string, forHotelId: string, overrides: Partial<{ name: string; capacity: number; pricePerNight: number }> = {}) {
      const response = await http()
        .post(`/api/hotels/${forHotelId}/rooms`)
        .set('Cookie', cookie)
        .send({ type: 'Standard', beds: 1, name: 'Room ' + (++roomSequence), capacity: 2, pricePerNight: 10000, ...overrides })
        .expect(201);
      await configureTestBookableRoom(connection,response.body._id,forHotelId);
      return response.body._id as string;
    }

    it('finds an active hotel with enough free capacity for the stay', async () => {
      await addRoom(moderatorCookie, hotelId, { capacity: 2, pricePerNight: 12000 });

      const response = await http()
        .get('/api/hotels/search')
        .query({ city: 'Cairo', checkIn: '2026-12-20', checkOut: '2026-12-27', guests: 2 })
        .expect(200);

      assert.equal(response.body.total, 1);
      assert.equal(response.body.items[0].hotelId, hotelId);
      assert.equal(response.body.items[0].fromPrice, 12000);
      assert.equal(response.body.pageSize, 10);
    });

    it('excludes a hotel without enough combined room capacity for the guest count', async () => {
      await addRoom(moderatorCookie, hotelId, { capacity: 1, pricePerNight: 8000 });

      const response = await http()
        .get('/api/hotels/search')
        .query({ city: 'Cairo', checkIn: '2026-12-20', checkOut: '2026-12-27', guests: 4, rooms: 1 })
        .expect(200);

      assert.equal(response.body.total, 0);
    });

    it('excludes a deactivated hotel', async () => {
      await addRoom(moderatorCookie, hotelId, { capacity: 2, pricePerNight: 9000 });
      await connection.collection('hotels').updateOne({ _id: new Types.ObjectId(hotelId) }, { $set: { isActive: false } });

      const response = await http()
        .get('/api/hotels/search')
        .query({ city: 'Cairo', checkIn: '2026-12-20', checkOut: '2026-12-27', guests: 1 })
        .expect(200);

      assert.equal(response.body.total, 0);
    });

    it('excludes a hotel whose only room is blocked for the requested dates', async () => {
      const roomId = await addRoom(moderatorCookie, hotelId, { capacity: 2, pricePerNight: 9000 });
      await http()
        .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .set('Cookie', moderatorCookie)
        .send({ startDate: '2026-12-18', endDate: '2026-12-25' })
        .expect(201);

      const overlapping = await http()
        .get('/api/hotels/search')
        .query({ city: 'Cairo', checkIn: '2026-12-20', checkOut: '2026-12-27', guests: 1 })
        .expect(200);
      assert.equal(overlapping.body.total, 0);

      const afterBlock = await http()
        .get('/api/hotels/search')
        .query({ city: 'Cairo', checkIn: '2026-12-25', checkOut: '2026-12-30', guests: 1 })
        .expect(200);
      assert.equal(afterBlock.body.total, 1);
    });

    it('sorts by price ascending and descending across hotels', async () => {
      await addRoom(moderatorCookie, hotelId, { capacity: 2, pricePerNight: 20000 });
      const second = await createHotelWithModerator({ name: 'Cheaper Hotel' }, 'second-hotel-moderator@example.com');
      await addRoom(second.cookie, second.hotelId, { capacity: 2, pricePerNight: 8000 });

      const ascending = await http()
        .get('/api/hotels/search')
        .query({ city: 'Cairo', checkIn: '2026-12-20', checkOut: '2026-12-27', guests: 1, sort: 'PRICE_ASC' })
        .expect(200);
      assert.equal(ascending.body.total, 2);
      assert.equal(ascending.body.items[0].hotelId, second.hotelId);

      const descending = await http()
        .get('/api/hotels/search')
        .query({ city: 'Cairo', checkIn: '2026-12-20', checkOut: '2026-12-27', guests: 1, sort: 'PRICE_DESC' })
        .expect(200);
      assert.equal(descending.body.items[0].hotelId, hotelId);
    });

    it('filters by minPrice and maxPrice', async () => {
      await addRoom(moderatorCookie, hotelId, { capacity: 2, pricePerNight: 15000 });

      const tooLow = await http()
        .get('/api/hotels/search')
        .query({ city: 'Cairo', checkIn: '2026-12-20', checkOut: '2026-12-27', guests: 1, minPrice: 16000 })
        .expect(200);
      assert.equal(tooLow.body.total, 0);

      const inRange = await http()
        .get('/api/hotels/search')
        .query({ city: 'Cairo', checkIn: '2026-12-20', checkOut: '2026-12-27', guests: 1, minPrice: 10000, maxPrice: 20000 })
        .expect(200);
      assert.equal(inRange.body.total, 1);
    });

    it('rejects a city outside the official reference catalog and an invalid date range', async () => {
      await http()
        .get('/api/hotels/search')
        .query({ city: 'Atlantis', checkIn: '2026-12-20', checkOut: '2026-12-27', guests: 1 })
        .expect(400);

      await http()
        .get('/api/hotels/search')
        .query({ city: 'Cairo', checkIn: '2026-12-27', checkOut: '2026-12-20', guests: 1 })
        .expect(400);
    });

    it('registers the search route in Swagger and needs no authentication', async () => {
      const doc = (await http().get('/api/docs-json').expect(200)).body;
      assert.ok(doc.paths['/api/hotels/search'].get);

      await http()
        .get('/api/hotels/search')
        .query({ city: 'Cairo', checkIn: '2026-12-20', checkOut: '2026-12-27', guests: 1 })
        .expect(200);
    });
  });

  describe('Available rooms - HTL-15', () => {
    it('lists only free rooms meeting the guest capacity, cheapest first', async () => {
      const small = (await http().post(`/api/hotels/${hotelId}/rooms`).set('Cookie', moderatorCookie)
        .send({ type: 'Standard', beds: 1, name: 'Small', capacity: 1, pricePerNight: 9000 }).expect(201)).body;
      const large = (await http().post(`/api/hotels/${hotelId}/rooms`).set('Cookie', moderatorCookie)
        .send({ type: 'Standard', beds: 1, name: 'Large', capacity: 4, pricePerNight: 20000 }).expect(201)).body;
      const largeCheap = (await http().post(`/api/hotels/${hotelId}/rooms`).set('Cookie', moderatorCookie)
        .send({ type: 'Standard', beds: 1, name: 'Large Cheap', capacity: 4, pricePerNight: 15000 }).expect(201)).body;

      for(const r of [small,large,largeCheap])await configureTestBookableRoom(connection,r._id,hotelId);
      const response = await http()
        .get(`/api/hotels/${hotelId}/rooms/available`)
        .query({ checkIn: '2026-12-20', checkOut: '2026-12-27', guests: 3 })
        .expect(200);

      const ids = response.body.items.map((room: { _id: string }) => room._id);
      assert.ok(!ids.includes(small._id), 'too-small room excluded');
      assert.deepEqual(ids, [largeCheap._id, large._id], 'cheapest first');
    });

    it('excludes a room blocked for the requested dates', async () => {
      const room = (await http().post(`/api/hotels/${hotelId}/rooms`).set('Cookie', moderatorCookie)
        .send({ type: 'Standard', beds: 1, name: 'Room', capacity: 2, pricePerNight: 9000 }).expect(201)).body;
      await configureTestBookableRoom(connection,room._id,hotelId);
      await http()
        .post(`/api/hotels/${hotelId}/rooms/${room._id}/availability`)
        .set('Cookie', moderatorCookie)
        .send({ startDate: '2026-12-20', endDate: '2026-12-27' })
        .expect(201);

      const response = await http()
        .get(`/api/hotels/${hotelId}/rooms/available`)
        .query({ checkIn: '2026-12-22', checkOut: '2026-12-24' })
        .expect(200);
      assert.equal(response.body.items.length, 0);
    });

    it('returns 404 for a deactivated or unknown hotel', async () => {
      await connection.collection('hotels').updateOne({ _id: new Types.ObjectId(hotelId) }, { $set: { isActive: false } });
      await http().get(`/api/hotels/${hotelId}/rooms/available`).query({ checkIn: '2026-12-20', checkOut: '2026-12-27' }).expect(404);
      await http().get(`/api/hotels/${new Types.ObjectId().toString()}/rooms/available`).query({ checkIn: '2026-12-20', checkOut: '2026-12-27' }).expect(404);
    });

    it('registers the route in Swagger', async () => {
      const doc = (await http().get('/api/docs-json').expect(200)).body;
      assert.ok(doc.paths['/api/hotels/{id}/rooms/available'].get);
    });
  });

  describe('Reservations - HTL-22', () => {
    it('registers the route in Swagger', async () => {
      const doc = (await http().get('/api/docs-json').expect(200)).body;
      assert.ok(doc.paths['/api/hotels/{id}/reservations'].get);
    });

    it('returns an empty reservation page for the assigned hotel', async () => {
      const result = await http().get(`/api/hotels/${hotelId}/reservations`).set('Cookie', moderatorCookie).expect(200);
      assert.deepEqual(result.body, { items: [], page: 1, pageSize: 10, total: 0, totalPages: 0 });
    });

    it('checks ownership before reading reservations: no assignment is 403, a mismatched one is 404', async () => {
      const otherModerator = await login('other-hotel-moderator@example.com', UserRole.HOTEL_MODERATOR);
      await http().get(`/api/hotels/${hotelId}/reservations`).set('Cookie', otherModerator).expect(403);

      const other = await users.findOne({ email: 'other-hotel-moderator@example.com' }).orFail().exec();
      await connection.collection('moderatorassignments').insertOne({ moderatorId: other._id, hotelId: new Types.ObjectId() });
      await http().get(`/api/hotels/${hotelId}/reservations`).set('Cookie', otherModerator).expect(404);
    });

    it('requires an authenticated hotel moderator', async () => {
      await http().get(`/api/hotels/${hotelId}/reservations`).expect(401);
      const ordinaryUser = await login('user@example.com');
      await http().get(`/api/hotels/${hotelId}/reservations`).set('Cookie', ordinaryUser).expect(403);
    });
  });

  describe('Hotel photos - HTL-01, HTL-02, GEN-08', () => {
    const upload = (cookie: string | undefined, file: Buffer | undefined, name = 'photo.png') => {
      const call = http().post(`/api/hotels/${hotelId}/photos`);
      if (cookie) call.set('Cookie', cookie);
      if (file) call.attach('photo', file, name);
      return call;
    };

    it('stores a photo and serves it by URL, up to the 5-photo limit', async () => {
      const created = await upload(moderatorCookie, PNG).expect(201);
      assert.equal(created.body.photos.length, 1);
      const photoId = created.body.photos[0]._id;
      assert.equal(created.body.photos[0].contentType, 'image/png');
      const url = `/api/hotels/${hotelId}/photos/${photoId}`;

      const image = await http().get(url).expect(200);
      assert.match(image.headers['content-type'], /image\/png/);

      await upload(moderatorCookie, JPG, 'photo.jpg').expect(201);
      for (let i = 0; i < 3; i++) await upload(moderatorCookie, PNG).expect(201);
      const full = await upload(moderatorCookie, PNG).expect(400);
      assert.match(full.body.message, /at most 5 photos/);

      const doc = (await http().get('/api/docs-json').expect(200)).body;
      assert.ok(doc.paths['/api/hotels/{id}/photos'].post);
      assert.ok(doc.paths['/api/hotels/{id}/photos/{photoId}'].get);
      assert.ok(doc.paths['/api/hotels/{id}/photos/{photoId}'].delete);
    });

    it('rejects non-images even when named .png, a missing file, and files over 5 MB', async () => {
      await upload(moderatorCookie, Buffer.from('not an image'), 'photo.png').expect(400);
      await upload(moderatorCookie, undefined).expect(400);
      await upload(moderatorCookie, Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])).expect(413);
    });

    it('rejects uploads without a session (401) and from a normal user (403)', async () => {
      await upload(undefined, PNG).expect(401);
      const ordinaryUser = await login('user@example.com');
      await upload(ordinaryUser, PNG).expect(403);
    });

    it('rejects uploading to, and deleting from, a hotel that is not the caller\'s own', async () => {
      const otherModerator = await login('other-photo-moderator@example.com', UserRole.HOTEL_MODERATOR);
      await upload(otherModerator, PNG).expect(403);

      const other = await users.findOne({ email: 'other-photo-moderator@example.com' }).orFail().exec();
      await connection.collection('moderatorassignments').insertOne({ moderatorId: other._id, hotelId: new Types.ObjectId() });
      await upload(otherModerator, PNG).expect(404);
    });

    it('removes a photo, which then 404s', async () => {
      const created = await upload(moderatorCookie, PNG).expect(201);
      const photoId = created.body.photos[0]._id;
      const url = `/api/hotels/${hotelId}/photos/${photoId}`;

      await http().delete(url).set('Cookie', moderatorCookie).expect(200);
      await http().get(url).expect(404);
      await http().delete(url).set('Cookie', moderatorCookie).expect(404);
    });

    it('hides a deactivated hotel\'s photos from guests, but not from its own moderator or an admin', async () => {
      const created = await upload(moderatorCookie, PNG).expect(201);
      const photoId = created.body.photos[0]._id;
      const url = `/api/hotels/${hotelId}/photos/${photoId}`;

      await connection.collection('hotels').updateOne({ _id: new Types.ObjectId(hotelId) }, { $set: { isActive: false } });
      await http().get(url).expect(404);
      await http().get(url).set('Cookie', moderatorCookie).expect(200);
      await http().get(url).set('Cookie', adminCookie).expect(200);
    });
  });
});
