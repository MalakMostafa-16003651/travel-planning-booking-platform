import { configureTestBookableRoom } from './hotel-test-data';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthMailQueueService } from '../src/auth/auth-mail-queue.service';
import { configureApplication } from '../src/configure-application';
import { RoomInventoryAdapter } from '../src/hotel-bookings/adapters/room-inventory.adapter';
import { CreateHotelBookingDto } from '../src/hotel-bookings/dto/create-hotel-booking.dto';
import { HotelBookingsModule } from '../src/hotel-bookings/hotel-bookings.module';
import { HotelBookingsService } from '../src/hotel-bookings/hotel-bookings.service';
import { Hotel } from '../src/hotels/schemas/hotel.schema';
import { Room } from '../src/hotels/schemas/room.schema';
import { MailService } from '../src/mail/mail.service';
import { User } from '../src/users/schemas/user.schema';

describe('ACC-02 real hotel booking verification integration', { concurrency: false }, () => {
  let app: INestApplication, mongo: MongoMemoryReplSet, connection: Connection, cookie: string, userId: string;
  let input: CreateHotelBookingDto; const sent: string[] = [];
  const http = () => request(app.getHttpServer());
  before(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    const testing = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true, load: [() => ({
        JWT_SECRET: randomBytes(48).toString('hex'), EMAIL_VERIFICATION_REQUIRED: 'true', EMAIL_VERIFICATION_URL: 'https://client.example/verify-email',
      })] }), MongooseModule.forRoot(mongo.getUri('email-verification-hotels')), AuthModule, HotelBookingsModule,
    ] }).overrideProvider(MailService).useValue({ isConfigured: () => true, async send(message: { text: string }) { sent.push(message.text); } }).compile();
    app = testing.createNestApplication(); configureApplication(app); await app.init(); connection = testing.get(getConnectionToken());
    await Promise.all(Object.values(connection.models).map((model) => model.init()));
  }, { timeout: 120_000 });
  after(async () => { await app?.get(AuthMailQueueService).whenIdle(); await app?.close(); await mongo?.stop(); });
  beforeEach(async () => {
    await app.get(AuthMailQueueService).whenIdle();
    await Promise.all((await connection.db!.collections()).map((collection) => collection.deleteMany({}))); sent.length = 0;
    await http().post('/api/auth/register').send({ name: 'Hotel Traveler', email: 'hotel-verification@example.com', password: 'Travel123', termsAccepted: true }).expect(201);
    await app.get(AuthMailQueueService).whenIdle();
    const logged = await http().post('/api/auth/login').send({ email: 'hotel-verification@example.com', password: 'Travel123' }).expect(200);
    userId = logged.body.userId; cookie = (logged.headers['set-cookie'] as unknown as string[]).map((value) => value.split(';')[0]).join('; ');
    const hotel = await app.get<Model<Hotel>>(getModelToken(Hotel.name)).create({ name: 'Verification Hotel', city: 'Cairo', countryCode: 'EG', address: 'Synthetic' });
    const room = await app.get<Model<Room>>(getModelToken(Room.name)).create({ hotelId: hotel._id, name: 'Room 1', capacity: 2, pricePerNight: 10000 });
    input = { hotelId: hotel._id.toString(), checkIn: '2035-12-20', checkOut: '2035-12-22', rooms: [{ roomId: room._id.toString(), adults: 1, childrenAges: [] }] };
  });
  async function verify() {
    const token = /#token=([a-f0-9]{64})/.exec(sent[0])![1];
    await http().post('/api/auth/verify-email').send({ token }).expect(204);
  }
  it('rejects unverified hotel creation before any inventory/booking write and permits the same cookie after verification', async () => {
    await http().post('/api/hotel-bookings').set('Cookie', cookie).send(input).expect(403);
    assert.equal(await connection.collection('hotelbookings').countDocuments(), 0);
    assert.equal(await connection.collection('roomavailabilities').countDocuments(), 0);
    await verify(); await configureTestBookableRoom(connection,input.rooms[0].roomId,input.hotelId); const response = await http().post('/api/hotel-bookings').set('Cookie', cookie).send(input).expect(201);
    assert.equal(response.body.status, 'PENDING'); assert.equal(response.body.userId, userId);
  });
  it('blocks direct internal hotel holds as well as HTTP access', async () => {
    await assert.rejects(() => app.get(HotelBookingsService).hold(input, userId), (error: unknown) => (error as { getStatus(): number }).getStatus() === 403);
    assert.equal(await connection.collection('hotelbookings').countDocuments(), 0);
    assert.equal(await connection.collection('roomavailabilities').countDocuments(), 0);
  });
  it('rechecks verification inside the hold transaction after asynchronous preflight', async (context) => {
    await verify(); const inventory = app.get(RoomInventoryAdapter), original = inventory.ensureAvailability.bind(inventory);
    const delayed = mock.method(inventory, 'ensureAvailability', async (...args: Parameters<typeof inventory.ensureAvailability>) => {
      await original(...args); await app.get<Model<User>>(getModelToken(User.name)).updateOne({ _id: userId }, { $unset: { emailVerifiedAt: '' } });
    });
    context.after(() => delayed.mock.restore());
    await http().post('/api/hotel-bookings').set('Cookie', cookie).send(input).expect(403);
    assert.equal(await connection.collection('hotelbookings').countDocuments(), 0);
    const availability = (await connection.collection('roomavailabilities').findOne({}))!;
    assert.deepEqual(availability.bookedRanges, []);
  });
  it('retains read access to an existing reservation after verification is absent', async () => {
    await verify(); await configureTestBookableRoom(connection,input.rooms[0].roomId,input.hotelId); const held = await http().post('/api/hotel-bookings').set('Cookie', cookie).send(input).expect(201);
    await app.get<Model<User>>(getModelToken(User.name)).updateOne({ _id: new Types.ObjectId(userId) }, { $unset: { emailVerifiedAt: '' } });
    const read = await http().get('/api/hotel-bookings/' + held.body.hotelBookingId).set('Cookie', cookie).expect(200);
    assert.equal(read.body.hotelBookingId, held.body.hotelBookingId);
  });
});
