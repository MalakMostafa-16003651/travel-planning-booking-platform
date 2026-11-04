import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { after, before, describe, it } from 'node:test';
import request, { Response } from 'supertest';
import { configureApplication } from '../src/configure-application';

class PassengerValidationDto {
  @IsString({ message: 'Full name must be a string' })
  @IsNotEmpty({ message: 'Full name is required' })
  fullName!: string;
}

class ValidationRequestDto {
  @IsString({ message: 'Title must be a string' })
  @IsNotEmpty({ message: 'Title is required' })
  title!: string;

  @IsString({ message: 'Password must be a string' })
  password!: string;

  @IsArray({ message: 'Passengers must be a list' })
  @ValidateNested({ each: true })
  @Type(() => PassengerValidationDto)
  passengers!: PassengerValidationDto[];
}

@Controller('validation-check')
class ValidationTestController {
  @Post()
  accept(@Body() _input: ValidationRequestDto) {
    return { accepted: true };
  }
}

const PRIVATE_PASSWORD = 'synthetic-password-not-for-error-output';
const PRIVATE_VALUE = 'synthetic-private-value-not-for-error-output';

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Validation test',
    password: PRIVATE_PASSWORD,
    passengers: [{ fullName: 'Test Passenger' }],
    ...overrides,
  };
}

function validationFields(response: Response): Record<string, string[]> {
  assert.equal(response.status, 400);
  assert.deepEqual(Object.keys(response.body).sort(), ['error', 'errors', 'message', 'statusCode']);
  assert.equal(response.body.statusCode, 400);
  assert.equal(response.body.error, 'Bad Request');
  assert.equal(response.body.message, 'Validation failed');
  const fields = response.body.errors as Record<string, string[]>;
  assert.ok(fields && typeof fields === 'object' && !Array.isArray(fields));
  for (const messages of Object.values(fields)) {
    assert.ok(Array.isArray(messages) && messages.length > 0);
    assert.ok(messages.every((message) => typeof message === 'string' && message.trim().length > 0));
  }
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes(PRIVATE_PASSWORD), false);
  assert.equal(serialized.includes(PRIVATE_VALUE), false);
  assert.equal(serialized.includes('"target"'), false);
  assert.equal(serialized.includes('"value"'), false);
  return fields;
}

describe('global nested DTO validation', { concurrency: false }, () => {
  let app: INestApplication;

  before(async () => {
    // This fixture has no ConfigModule, AuthModule, MongoDB, or environment-file load.
    const moduleRef = await Test.createTestingModule({ controllers: [ValidationTestController] }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  after(async () => {
    if (app) await app.close();
  });

  it('accepts a valid nested request through the shared application pipeline', async () => {
    const response = await request(app.getHttpServer()).post('/api/validation-check')
      .set('Sec-Fetch-Site', 'same-origin').send(validBody()).expect(201);
    assert.deepEqual(response.body, { accepted: true });
  });

  it('returns nonempty dotted leaf messages and omits empty array/container fields', async () => {
    const response = await request(app.getHttpServer()).post('/api/validation-check')
      .set('Sec-Fetch-Site', 'same-origin')
      .send(validBody({ passengers: [{ fullName: 123 }, { fullName: '' }] }));
    const fields = validationFields(response);
    assert.deepEqual(Object.keys(fields).sort(), ['passengers.0.fullName', 'passengers.1.fullName']);
    assert.ok(fields['passengers.0.fullName'].includes('Full name must be a string'));
    assert.ok(fields['passengers.1.fullName'].includes('Full name is required'));
    assert.equal(Object.hasOwn(fields, 'passengers'), false);
    assert.equal(Object.hasOwn(fields, 'passengers.0'), false);
  });

  it('rejects an unknown nested property without echoing its private value', async () => {
    const response = await request(app.getHttpServer()).post('/api/validation-check')
      .set('Sec-Fetch-Site', 'same-origin')
      .send(validBody({ passengers: [{ fullName: 'Test Passenger', unexpected: PRIVATE_VALUE }] }));
    const fields = validationFields(response);
    assert.deepEqual(Object.keys(fields), ['passengers.0.unexpected']);
    assert.ok(fields['passengers.0.unexpected'].includes('property unexpected should not exist'));
  });

  it('preserves the ordinary top-level error shape and messages', async () => {
    const response = await request(app.getHttpServer()).post('/api/validation-check')
      .set('Sec-Fetch-Site', 'same-origin').send(validBody({ title: '' }));
    const fields = validationFields(response);
    assert.deepEqual(Object.keys(fields), ['title']);
    assert.deepEqual(fields.title, ['Title is required']);
  });

  it('excludes dangerous prototype paths while retaining useful nested validation messages', async () => {
    const passenger = JSON.parse(
      '{"fullName":"","__proto__":{"pollutedByValidationTest":true},"constructor":{"prototype":{"pollutedByValidationTest":true}},"prototype":"ignored","constructor.prototype.pollutedByValidationTest":"ignored","__proto__.pollutedByValidationTest":"ignored"}',
    ) as Record<string, unknown>;
    passenger.unexpected = PRIVATE_VALUE;
    const response = await request(app.getHttpServer()).post('/api/validation-check')
      .set('Sec-Fetch-Site', 'same-origin').send(validBody({ passengers: [passenger] }));
    const fields = validationFields(response);
    assert.ok(fields['passengers.0.fullName'].includes('Full name is required'));
    assert.ok(fields['passengers.0.unexpected'].includes('property unexpected should not exist'));
    const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
    assert.ok(Object.keys(fields).every((path) => path.split('.').every((segment) => !unsafe.has(segment))));
    assert.equal(Object.hasOwn(fields, '__proto__'), false);
    assert.equal(Object.hasOwn(fields, 'constructor'), false);
    assert.equal(Reflect.get(Object.prototype, 'pollutedByValidationTest') === undefined, true);
  });
});
