import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateBookingReference, passengerFare, passengerTypeOn, refundAmountFor, refundPercentageFor, wholeDaysBefore } from '../src/flight-bookings/flight-booking.rules';
import { PassengerType } from '../src/flight-bookings/schemas/flight-booking.schema';

const departure = new Date('2027-06-15T10:00:00Z');

describe('flight booking rules', () => {
  it('classifies passengers exactly on their birthdays', () => {
    assert.equal(passengerTypeOn(new Date('2015-06-15'), departure), PassengerType.ADULT);
    assert.equal(passengerTypeOn(new Date('2015-06-16'), departure), PassengerType.CHILD);
    assert.equal(passengerTypeOn(new Date('2025-06-15'), departure), PassengerType.CHILD);
    assert.equal(passengerTypeOn(new Date('2025-06-16'), departure), PassengerType.INFANT);
    assert.equal(passengerTypeOn(new Date('2027-06-16'), departure), null);
  });

  it('charges infants 10% of the fare', () => {
    assert.equal(passengerFare(15000, PassengerType.ADULT), 15000);
    assert.equal(passengerFare(15000, PassengerType.CHILD), 15000);
    assert.equal(passengerFare(15005, PassengerType.INFANT), 1501);
  });

  it('counts whole days, rounding down', () => {
    assert.equal(wholeDaysBefore(departure, new Date('2027-06-08T10:00:00Z')), 7);
    assert.equal(wholeDaysBefore(departure, new Date('2027-06-08T10:00:01Z')), 6);
  });

  it('selects the highest tier not exceeding the days remaining (FLT-09)', () => {
    const tiers = [
      { daysBeforeDeparture: 14, refundPercentage: 100 },
      { daysBeforeDeparture: 2, refundPercentage: 25 },
      { daysBeforeDeparture: 7, refundPercentage: 50 },
    ];
    assert.equal(refundPercentageFor(tiers, 14), 100);
    assert.equal(refundPercentageFor(tiers, 13), 50);
    assert.equal(refundPercentageFor(tiers, 2), 25);
    assert.equal(refundPercentageFor(tiers, 1), 0);
    assert.equal(refundPercentageFor([], 100), 0);
  });

  it('computes refunds on the total', () => {
    assert.equal(refundAmountFor(15000, 50), 7500);
    assert.equal(refundAmountFor(15001, 50), 7501);
    assert.equal(refundAmountFor(15000, 0), 0);
  });

  it('generates unambiguous references', () => {
    for (let index = 0; index < 200; index += 1) assert.match(generateBookingReference(), /^[A-HJ-NP-Z2-9]{8}$/);
  });
});
