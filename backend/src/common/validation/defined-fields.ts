/**
 * True when at least one property of a request DTO was actually supplied.
 * Object.keys() is not enough: with the project's TypeScript target (ES2022+, useDefineForClassFields),
 * every declared optional DTO field exists as an own property set to undefined, so {} still has keys.
 */
export function hasDefinedField(input: object): boolean {
  return Object.values(input).some((value) => value !== undefined);
}
