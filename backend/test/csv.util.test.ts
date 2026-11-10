import assert from 'node:assert/strict';
import test from 'node:test';
import { csvCell, csvRow } from '../src/flights/csv.util';

test('quotes values and doubles inner quotes', () => {
  assert.equal(csvCell('Ann "AJ" Lee'), '"Ann ""AJ"" Lee"');
  assert.equal(csvCell('a,b'), '"a,b"');
});

test('neutralises spreadsheet formulas', () => {
  for (const evil of ['=1+1', '+cmd', '-2', '@SUM(A1)']) assert.equal(csvCell(evil), `"'${evil}"`);
});

test('null and undefined become empty cells, numbers are kept', () => {
  assert.equal(csvRow([null, undefined, 3]), '"","","3"');
});
