import type { FlightSelection, PassengerInput, PassengerType } from './types';
import { passengerTypeName } from './format';

// Early feedback only. The backend repeats every rule and has the final say (FLT-12, FLT-19, GEN-13).

export interface PassengerDraft {
  type: PassengerType;
  fullName: string;
  dateOfBirth: string;
  documentNumber: string;
  extraBags: string;
  extraBaggageWeightKg: string;
}

export interface BaggageRules {
  maxExtraBags: number;
  maxWeightPerBagKg: number;
  /** What one extra bag costs across every flight of the trip, in minor units. */
  pricePerBag: number;
}

/** Keyed like the backend's errors, for example "passengers.0.fullName". */
export type FieldErrors = Record<string, string>;

const ageHint: Record<PassengerType, string> = {
  ADULT: '12 or older on the departure date',
  CHILD: '2 to 11 on the departure date',
  INFANT: 'under 2 on the departure date, travelling on an adult’s lap',
};

export function typeHint(type: PassengerType): string {
  return ageHint[type];
}

export function emptyPassengers(selection: FlightSelection): PassengerDraft[] {
  const blank = { fullName: '', dateOfBirth: '', documentNumber: '', extraBags: '0', extraBaggageWeightKg: '' };
  const list = (type: PassengerType, amount: number) => Array.from({ length: amount }, () => ({ type, ...blank }));
  return [...list('ADULT', selection.adults), ...list('CHILD', selection.children), ...list('INFANT', selection.infants)];
}

/** The backend's own rule: whole years on the outbound departure, compared in UTC. */
export function typeOn(dateOfBirth: string, departureIso: string): PassengerType | null {
  const birth = new Date(`${dateOfBirth}T00:00:00.000Z`);
  const departure = new Date(departureIso);
  if (Number.isNaN(birth.getTime()) || birth > departure) return null;
  const hadBirthday = departure.getUTCMonth() > birth.getUTCMonth()
    || (departure.getUTCMonth() === birth.getUTCMonth() && departure.getUTCDate() >= birth.getUTCDate());
  const age = departure.getUTCFullYear() - birth.getUTCFullYear() - (hadBirthday ? 0 : 1);
  if (age >= 12) return 'ADULT';
  return age >= 2 ? 'CHILD' : 'INFANT';
}

export function validatePassengers(drafts: PassengerDraft[], departureIso: string, baggage: BaggageRules): FieldErrors {
  const errors: FieldErrors = {};
  drafts.forEach((draft, index) => {
    const at = (field: keyof PassengerDraft) => `passengers.${index}.${field}`;
    const name = draft.fullName.trim();
    if (!name) errors[at('fullName')] = 'Enter the full name.';
    else if (name.length > 100) errors[at('fullName')] = 'Use at most 100 characters.';

    if (!draft.dateOfBirth) {
      errors[at('dateOfBirth')] = 'Enter the date of birth.';
    } else {
      const actual = typeOn(draft.dateOfBirth, departureIso);
      if (!actual) errors[at('dateOfBirth')] = 'Enter a real date before the departure.';
      else if (actual !== draft.type) {
        errors[at('dateOfBirth')] = `This traveler counts as ${passengerTypeName(actual).toLowerCase()} on the departure date. Change the date, or search again with the right passenger numbers.`;
      }
    }

    if (!/^[A-Za-z0-9-]{5,20}$/.test(draft.documentNumber.trim())) {
      errors[at('documentNumber')] = 'Use 5 to 20 letters, digits or hyphens.';
    }

    const bags = Number(draft.extraBags || '0');
    const weight = Number(draft.extraBaggageWeightKg);
    if (!Number.isInteger(bags) || bags < 0) errors[at('extraBags')] = 'Enter a whole number of bags.';
    else if (bags > baggage.maxExtraBags) errors[at('extraBags')] = `At most ${baggage.maxExtraBags} per traveler on this trip.`;
    else if (bags > 0) {
      const limit = bags * baggage.maxWeightPerBagKg;
      if (!draft.extraBaggageWeightKg.trim() || !Number.isFinite(weight) || weight <= 0) errors[at('extraBaggageWeightKg')] = 'Enter the total weight of the extra bags.';
      else if (weight > limit) errors[at('extraBaggageWeightKg')] = `At most ${limit} kg for ${bags} ${bags === 1 ? 'bag' : 'bags'} (${baggage.maxWeightPerBagKg} kg each).`;
    }
  });
  return errors;
}

export function toPassengerInput(draft: PassengerDraft): PassengerInput {
  const bags = Number(draft.extraBags || '0');
  return {
    fullName: draft.fullName.trim(),
    dateOfBirth: draft.dateOfBirth,
    documentNumber: draft.documentNumber.trim(),
    type: draft.type,
    // The backend rejects a weight without bags, so both are sent together or not at all.
    ...(bags > 0 ? { extraBags: bags, extraBaggageWeightKg: Number(draft.extraBaggageWeightKg) } : {}),
  };
}

/**
 * Field errors arrive as "passengers.0.fullName". Booking rules arrive under "passengers" and start
 * with the traveler's name, so they cannot always be tied to one field and are returned separately.
 */
export function readServerErrors(fields: Record<string, string[]>): { fields: FieldErrors; general: string[] } {
  const result: FieldErrors = {};
  const general: string[] = [];
  for (const [key, messages] of Object.entries(fields)) {
    if (/^passengers\.\d+\.\w+$/.test(key)) result[key] = messages[0];
    else general.push(...messages);
  }
  return { fields: result, general };
}
