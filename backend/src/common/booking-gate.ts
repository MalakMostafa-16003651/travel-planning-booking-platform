/** Reject malformed/exhausted counters; missing/null legacy values start at zero. */
export function incrementableVersion(field: 'credentialVersion' | 'bookingVersion') {
  const version = { $ifNull: ['$' + field, 0] };
  return { $cond: [ { $isNumber: version }, { $and: [
    { $gte: [version, 0] }, { $lt: [version, Number.MAX_SAFE_INTEGER] },
    { $eq: [version, { $trunc: version }] },
  ] }, false ] };
}

/** Private write, with public updatedAt unchanged: status edits conflict on this same document. */
export const advanceBookingVersion = () => [{ $set: {
  bookingVersion: { $add: [{ $ifNull: ['$bookingVersion', 0] }, 1] },
} }];

export function hideBookingVersion(_document: unknown, value: { bookingVersion?: unknown }) {
  delete value.bookingVersion;
  return value;
}
