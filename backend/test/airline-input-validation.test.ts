import assert from 'node:assert/strict';
import { it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAirlineDto } from '../src/airlines/dto/create-airline.dto';
import { UpdateAirlineDto } from '../src/airlines/dto/update-airline.dto';

it('rejects whitespace-only airline names before model persistence and trims valid names', async () => {
  for (const Dto of [CreateAirlineDto, UpdateAirlineDto]) {
    const invalid = plainToInstance(Dto, { name: '   ', code: 'TA' });
    assert.ok((await validate(invalid)).some((error) => error.property === 'name'));
    const valid = plainToInstance(Dto, { name: '  Test Airways  ', code: 'TA' });
    assert.equal((await validate(valid)).length, 0);
    assert.equal(valid.name, 'Test Airways');
  }
});
