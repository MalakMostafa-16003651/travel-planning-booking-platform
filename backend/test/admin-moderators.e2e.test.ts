import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { AdminModule } from '../src/admin/admin.module';
import { AirlinesModule } from '../src/airlines/airlines.module';
import { UserRole } from '../src/common/enums/user-role.enum';
import { AdminFixture, Session } from './admin-fixture';

describe('ACC-13 moderator accounts', { concurrency: false }, () => {
  // AirlinesModule proves Person 3's real assignment lookup accepts what this feature creates.
  const fixture = new AdminFixture([AdminModule, AirlinesModule]);
  let admin: Session;
  let user: Session;
  let airlineId: string;
  let hotelId: string;

  const collection = (name: string) => fixture.connection.collection(name);
  const create = (body: Record<string, unknown>, session = admin) =>
    fixture.http().post('/api/admin/moderators').set('Cookie', session.cookie).send(body);
  const airlineModerator = (fields: Record<string, unknown> = {}) => ({
    name: '  Nile Air Desk ', email: ' Desk@NileAir.com ', role: 'AIRLINE_MODERATOR', providerId: airlineId, temporaryPassword: 'Temp1234', ...fields,
  });
  const login = (email: string, password: string) =>
    fixture.http().post('/api/auth/login').set('Sec-Fetch-Site', 'same-origin').send({ email, password });
  const cookiesOf = (response: { headers: Record<string, unknown> }) =>
    (response.headers['set-cookie'] as string[]).map((cookie) => cookie.split(';')[0]).join('; ');

  before(() => fixture.start('admin-moderators'), { timeout: 30 * 60_000 });
  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    admin = await fixture.login('admin@example.com', UserRole.ADMIN);
    user = await fixture.login('nour@example.com');
    airlineId = (await collection('airlines').insertOne({ name: 'Nile Air', code: 'NA', isActive: true, baggagePolicy: { pricePerExtraBag: 1, maxExtraBagsPerPassenger: 0 }, cancellationTiers: [] })).insertedId.toString();
    hotelId = (await collection('hotels').insertOne({ name: 'Cataract Hotel', city: 'Aswan', countryCode: 'EG', address: 'Corniche', isActive: true })).insertedId.toString();
  });

  it('ACC-13: creates an airline moderator linked to exactly one airline, without returning the password', async () => {
    const response = await create(airlineModerator()).expect(201);
    const body = response.body;
    assert.equal(body.name, 'Nile Air Desk');
    assert.equal(body.email, 'desk@nileair.com');
    assert.equal(body.role, 'AIRLINE_MODERATOR');
    assert.equal(body.status, 'ACTIVE');
    assert.equal(body.providerType, 'airline');
    assert.equal(body.providerId, airlineId);
    assert.equal(body.providerName, 'Nile Air');
    assert.equal(body.mustChangePassword, true);
    assert.equal(JSON.stringify(body).includes('Temp1234'), false);
    assert.equal(JSON.stringify(body).toLowerCase().includes('hash'), false);

    const stored = await collection('users').findOne({ _id: new Types.ObjectId(body.userId) });
    assert.equal(stored!.mustChangePassword, true);
    assert.notEqual(stored!.passwordHash, 'Temp1234');
    assert.match(stored!.passwordHash, /^scrypt\$/);

    const assignments = await collection('moderatorassignments').find().toArray();
    assert.equal(assignments.length, 1);
    assert.equal(assignments[0].moderatorId.toString(), body.userId);
    assert.equal(assignments[0].airlineId.toString(), airlineId);
    assert.equal(assignments[0].hotelId, undefined);

    const [entry] = await collection('auditlogs').find().toArray();
    assert.equal(entry.action, 'MODERATOR_CREATED');
    assert.equal(entry.targetId.toString(), body.userId);
    assert.match(entry.details, /Nile Air/);
  });

  it('ACC-13: the moderator must change the temporary password, then manages their own airline', async () => {
    await create(airlineModerator()).expect(201);

    const first = await login('desk@nileair.com', 'Temp1234').expect(200);
    assert.deepEqual(first.body, { passwordChangeRequired: true });
    await fixture.http().patch('/api/auth/change-password').set('Cookie', cookiesOf(first)).set('Sec-Fetch-Site', 'same-origin')
      .send({ currentPassword: 'Temp1234', newPassword: 'MyOwnPass99' }).expect(204);

    const normal = await login('desk@nileair.com', 'MyOwnPass99').expect(200);
    assert.equal(normal.body.role, 'AIRLINE_MODERATOR');
    // Person 3's real moderatorassignments lookup finds the assigned airline.
    const own = await fixture.http().get('/api/airlines/me').set('Cookie', cookiesOf(normal)).expect(200);
    assert.equal(own.body.name, 'Nile Air');
  });

  it('ACC-13: creates a hotel moderator linked to the hotel only', async () => {
    const response = await create({ name: 'Front Desk', email: 'desk@cataract.com', role: 'HOTEL_MODERATOR', providerId: hotelId, temporaryPassword: 'Temp1234' }).expect(201);
    assert.equal(response.body.providerType, 'hotel');
    assert.equal(response.body.providerName, 'Cataract Hotel');
    const [assignment] = await collection('moderatorassignments').find().toArray();
    assert.equal(assignment.hotelId.toString(), hotelId);
    assert.equal(assignment.airlineId, undefined);
  });

  it('ACC-13: the provider must exist and match the role; nothing is created otherwise', async () => {
    await create(airlineModerator({ providerId: new Types.ObjectId().toString() })).expect(404);
    // An airline moderator cannot be assigned to a hotel, or the reverse.
    await create(airlineModerator({ providerId: hotelId })).expect(404);
    await create(airlineModerator({ role: 'HOTEL_MODERATOR', providerId: airlineId })).expect(404);
    assert.equal(await collection('users').countDocuments({ role: { $in: ['AIRLINE_MODERATOR', 'HOTEL_MODERATOR'] } }), 0);
    assert.equal(await collection('moderatorassignments').countDocuments(), 0);
    assert.equal(await collection('auditlogs').countDocuments(), 0);
  });

  it('ACC-13: rejects a registered email, leaving no half-created moderator', async () => {
    await create(airlineModerator({ email: 'NOUR@example.com' })).expect(409);
    await create(airlineModerator()).expect(201);
    const duplicate = await create(airlineModerator({ name: 'Second' })).expect(409);
    assert.deepEqual(duplicate.body.errors, { email: ['Email is already registered'] });
    assert.equal(await collection('moderatorassignments').countDocuments(), 1);
    assert.equal(await collection('auditlogs').countDocuments(), 1);
  });

  it('ACC-13/GEN-13: validates every field and blocks privilege injection', async () => {
    await create(airlineModerator({ role: 'ADMIN' })).expect(400);
    await create(airlineModerator({ role: 'USER' })).expect(400);
    await create(airlineModerator({ temporaryPassword: 'short1' })).expect(400);
    await create(airlineModerator({ temporaryPassword: 'nodigitshere' })).expect(400);
    await create(airlineModerator({ email: 'not-an-email' })).expect(400);
    await create(airlineModerator({ name: '   ' })).expect(400);
    await create(airlineModerator({ providerId: 'nope' })).expect(400);
    await create(airlineModerator({ status: 'SUSPENDED' })).expect(400);
    await create(airlineModerator({ mustChangePassword: false })).expect(400);
    assert.equal(await collection('users').countDocuments({ email: 'desk@nileair.com' }), 0);
  });

  it('ACC-13: two moderators can manage the same airline, each with one assignment', async () => {
    await create(airlineModerator()).expect(201);
    await create(airlineModerator({ email: 'second@nileair.com' })).expect(201);
    assert.equal(await collection('moderatorassignments').countDocuments({ airlineId: new Types.ObjectId(airlineId) }), 2);
  });

  it('ACC-13: only administrators can create moderators', async () => {
    await create(airlineModerator(), user).expect(403);
    await fixture.http().post('/api/admin/moderators').send(airlineModerator()).expect(401);
    assert.equal(await collection('moderatorassignments').countDocuments(), 0);
  });

  it('lists the endpoint in Swagger with ACC-13 and hides the password from responses', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    const operation = document.paths['/api/admin/moderators'].post;
    assert.match(operation.summary, /^ACC-13/);
    assert.equal(document.components.schemas.CreateModeratorDto.properties.temporaryPassword.writeOnly, true);
  });
});
