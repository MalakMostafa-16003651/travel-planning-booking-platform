import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Injectable, INestApplication, Module } from '@nestjs/common';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import request from 'supertest';
import { configureApplication } from '../src/configure-application';
import { ReferenceDataModule } from '../src/reference-data/reference-data.module';
import { ReferenceDataService } from '../src/reference-data/reference-data.service';

@Injectable()
class ActivityReferenceConsumer {
  constructor(readonly references: ReferenceDataService) {}
}
@Module({ imports: [ReferenceDataModule], providers: [ActivityReferenceConsumer] })
class ConsumerModule {}

// Independent transcription of the official workbook's eight rows.
const OFFICIAL = [
  ['att-1', 'Giza Pyramids and Sphinx', 'cairo'],
  ['att-2', 'Burj Khalifa Observation Deck', 'dubai'],
  ['att-3', 'British Museum', 'london'],
  ['att-4', 'Central Park', 'new_york'],
  ['att-5', 'Louvre Museum', 'paris'],
  ['att-6', 'Senso-ji Temple', 'tokyo'],
  ['att-7', 'Kingdom Centre Tower (Sky Bridge)', 'riyadh'],
  ['att-8', 'Römerberg', 'frankfurt'],
];

describe('shared official attraction catalog', { concurrency: false }, () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication;
  let connection: Connection;
  let references: ReferenceDataService;
  before(async () => {
    mongo = await MongoMemoryServer.create();
    const module = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.getUri('reference-catalog')), ConsumerModule],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    connection = module.get(getConnectionToken());
    references = module.get(ActivityReferenceConsumer).references;
  }, { timeout: 120_000 });
  beforeEach(async () => {
    for (const name of ['countries', 'cities', 'attractions']) await connection.collection(name).deleteMany({});
  });
  after(async () => { await app?.close(); await mongo?.stop(); });

  it('does not seed on startup; public reads are empty until explicit setup', async () => {
    await references.onModuleInit();
    assert.equal(await references.findAttraction('att-1'), null);
    await request(app.getHttpServer()).get('/api/attractions').expect(200, []);
    for (const name of ['countries', 'cities', 'attractions']) assert.equal(await connection.collection(name).countDocuments(), 0);
  });

  it('seeds all exact official IDs and names with existing city links, timestamps and unique identifiers', async () => {
    assert.deepEqual(await references.seedSupported(), { countries: 8, cities: 8, attractions: 8 });
    for (const [attractionId, name, cityId] of OFFICIAL) {
      const row = await references.findAttraction(attractionId);
      assert.ok(row);
      assert.equal(row.name, name);
      assert.equal(row.cityId, cityId);
      assert.ok(row.createdAt instanceof Date && row.updatedAt instanceof Date);
      assert.ok(await connection.collection('cities').findOne({ cityId: row.cityId }));
    }
    await assert.rejects(connection.collection('attractions').insertOne({ attractionId: 'att-1', name: 'Duplicate', cityId: 'cairo' }), { code: 11000 });
  });

  it('repeat seeding preserves existing values, identities, timestamps and unrelated rows', async () => {
    await references.seedSupported();
    await connection.collection('attractions').updateOne({ attractionId: 'att-1' }, { $set: { name: 'Preserved local label' } });
    await connection.collection('attractions').insertOne({ attractionId: 'custom-id', name: 'Unrelated', cityId: 'cairo' });
    const before = await connection.collection('attractions').find().sort({ attractionId: 1 }).toArray();
    await references.seedSupported();
    await references.seedSupported();
    assert.deepEqual(await connection.collection('attractions').find().sort({ attractionId: 1 }).toArray(), before);
    assert.equal(await references.findAttraction('custom-id'), null);
    for (const id of ['att-999', 'ATT-1', ' att-1 ', '']) assert.equal(await references.findAttraction(id), null);
    assert.equal((await references.listAttractions()).length, 8);
  });

  it('exposes public safe DTOs and Swagger with no catalog write routes', async () => {
    await references.seedSupported();
    const response = await request(app.getHttpServer()).get('/api/attractions').expect(200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.body.map((r: { attractionId: string; name: string; cityId: string }) => [r.attractionId, r.name, r.cityId]).sort(), [...OFFICIAL].sort());
    assert.deepEqual(Object.keys(response.body[0]).sort(), ['attractionId', 'cityId', 'name']);
    const document = (await request(app.getHttpServer()).get('/api/docs-json').expect(200)).body;
    assert.ok(document.paths['/api/attractions'].get.responses['200']);
    for (const method of ['post', 'patch', 'delete']) assert.equal(document.paths['/api/attractions'][method], undefined);
    await request(app.getHttpServer()).post('/api/attractions').send({}).expect(404);
  });

  it('runs the actual explicit seed CLI against an isolated database without reading private .env', async () => {
    const script = resolve(__dirname, '../src/scripts/seed-references.js');
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveResult, reject) => {
      const child = spawn(process.execPath, [script, '--no-env-file'], {
        env: { ...process.env, MONGODB_URI: mongo.getUri('reference-catalog') },
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
      });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.once('error', () => reject(new Error('Isolated reference seed process could not start')));
      child.once('close', (code) => resolveResult({ code, stdout, stderr }));
    });
    assert.ok(result.code === 0, 'Seed CLI must exit successfully');
    assert.ok(result.stderr === '', 'Seed CLI must not report errors');
    assert.equal(result.stdout, 'Reference seed completed: 8 countries, 8 cities and 8 attractions available.\n');
    assert.equal(await connection.collection('attractions').countDocuments(), 8);
    assert.ok(await references.findAttraction('att-8'));
  });
});
