import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { UserRole } from '../src/common/enums/user-role.enum';
import { ItineraryExportsModule } from '../src/itinerary-exports/itinerary-exports.module';
import { ReferenceDataService } from '../src/reference-data/reference-data.service';
import { AdminFixture, Session } from './admin-fixture';

describe('ITN-28 standalone printable itinerary export', { concurrency: false }, () => {
  const fixture = new AdminFixture([ItineraryExportsModule]); let owner: Session, other: Session, admin: Session, id: string;
  const path = () => '/api/itineraries/' + id + '/pdf';
  const download = (actor?: Session) => {
    const call = fixture.http().get(path()); if (actor) call.set('Cookie', actor.cookie);
    return call.buffer().parse((response, done) => { const chunks: Buffer[] = []; response.on('data', (chunk: Buffer) => chunks.push(chunk)); response.on('end', () => done(null, Buffer.concat(chunks))); });
  };
  async function create() {
    const result = await fixture.http().post('/api/itineraries').set('Cookie', owner.cookie).send({ title: 'Cairo رحلة القاهرة and London', description: 'A printable plan with original budget currencies and safe itinerary access.', countries: ['EG', 'GB'], startDate: '2030-12-20', visibility: 'PRIVATE', currency: 'USD' }).expect(201);
    id = result.body.itineraryId;
  }
  before(() => fixture.start('itinerary-exports'), { timeout: 120_000 }); after(() => fixture.stop());
  beforeEach(async () => {
    await fixture.reset(); await fixture.app.get(ReferenceDataService).seedSupported();
    await fixture.connection.collection('currencies').insertMany([{ code: 'USD', name: 'US dollar' }, { code: 'EGP', name: 'Egyptian pound' }]);
    owner = await fixture.login('pdf-owner@example.com', UserRole.USER, 'PDF Owner'); other = await fixture.login('pdf-other@example.com'); admin = await fixture.login('pdf-admin@example.com', UserRole.ADMIN); await create();
  });
  it('exports the owner private itinerary as PDF without changing its stored data', async () => {
    const before = await fixture.connection.collection('itineraries').findOne({ _id: new Types.ObjectId(id) }); const response = await download(owner).expect(200);
    assert.equal(response.headers['content-type'], 'application/pdf'); assert.equal(response.headers['cache-control'], 'no-store'); assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['content-disposition'], 'attachment; filename="itinerary-' + id + '.pdf"'); assert.equal(response.body.subarray(0, 5).toString(), '%PDF-');
    assert.ok(response.body.length > 5_000); assert.equal(Number(response.headers['content-length']), response.body.length);
    assert.deepEqual(await fixture.connection.collection('itineraries').findOne({ _id: new Types.ObjectId(id) }), before);
  });
  it('denies guests, other users and administrators a private export', async () => {
    await download().expect(401); await download(other).expect(404); await download(admin).expect(404);
    await fixture.http().get(path() + '?userId=' + owner.userId).set('Cookie', other.cookie).expect(404);
  });
  it('allows logged-in users to export a public itinerary and follows deactivated-author visibility', async () => {
    await fixture.http().patch('/api/itineraries/' + id).set('Cookie', owner.cookie).send({ visibility: 'PUBLIC' }).expect(200);
    await download(other).expect(200); await fixture.users.updateOne({ _id: owner.userId }, { $set: { status: 'DEACTIVATED' } }); await download(other).expect(404);
  });
  it('validates IDs and reports missing itineraries without a PDF response', async () => {
    await fixture.http().get('/api/itineraries/not-an-id/pdf').set('Cookie', owner.cookie).expect(400);
    id = new Types.ObjectId().toString(); const missing = await fixture.http().get(path()).set('Cookie', owner.cookie).expect(404); assert.match(missing.headers['content-type'], /application\/json/);
  });
  it('uses reordered dates, activities, budgets and transport from the existing read service; writes a visual QA sample', async () => {
    const days: string[] = [];
    for (const city of ['Cairo', 'London']) {
      const day = await fixture.http().post('/api/itineraries/' + id + '/days').set('Cookie', owner.cookie).send({ city, notes: 'Travel at a comfortable pace. Keep time for transfers and breaks.' }).expect(201);
      days.push(day.body.days[day.body.days.length - 1].dayId);
    }
    for (const [index, dayId] of days.entries()) {
      for (let n = 0; n < 3; n++) await fixture.http().post('/api/itineraries/' + id + '/days/' + dayId + '/activities').set('Cookie', owner.cookie).send({ title: (index ? 'London walk ' : 'Cairo museum visit ') + (n + 1), description: 'Explore the area and enjoy the local history. '.repeat(6), location: index ? 'Central London' : 'Downtown Cairo', startTime: '09:00', endTime: '11:00', cost: 25.5, currency: 'USD' }).expect(201);
      await fixture.http().post('/api/itineraries/' + id + '/days/' + dayId + '/budgets').set('Cookie', owner.cookie).send({ category: 'FOOD', amount: 450.5, currency: 'EGP', description: 'Lunch and local snacks' }).expect(201);
    }
    await fixture.http().post('/api/itineraries/' + id + '/transport-costs').set('Cookie', owner.cookie).send({ fromCity: 'Cairo', toCity: 'London', mode: 'FLIGHT', amount: 120, currency: 'USD', dayId: days[1], notes: 'Illustrative transport estimate, not a booking.' }).expect(201);
    await fixture.http().patch('/api/itineraries/' + id + '/days/reorder').set('Cookie', owner.cookie).send({ dayIds: [...days].reverse() }).expect(200);
    const before = await fixture.connection.collection('itineraries').findOne({ _id: new Types.ObjectId(id) });
    const response = await download(owner).expect(200); const output = resolve('.test-dist/acc02/itinerary-preview.pdf'); mkdirSync(resolve('.test-dist/acc02'), { recursive: true }); writeFileSync(output, response.body);
    assert.deepEqual(await fixture.connection.collection('itineraries').findOne({ _id: new Types.ObjectId(id) }), before);
  });
  it('exposes the PDF endpoint through Swagger without replacing existing itinerary endpoints', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    assert.match(document.paths['/api/itineraries/{itineraryId}/pdf'].get.summary, /ITN-28/); assert.ok(document.paths['/api/itineraries/{id}'].get);
    assert.ok(document.paths['/api/itineraries/{itineraryId}/pdf'].get.responses['200'].content['application/pdf']);
  });
});
