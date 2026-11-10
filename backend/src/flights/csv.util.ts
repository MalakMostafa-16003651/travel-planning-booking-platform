/**
 * FLT-29: builds CSV text safely.
 * - every value is quoted and inner quotes are doubled;
 * - a value starting with = + - @ (or a tab/CR) gets a leading ' so Excel cannot run it as a formula.
 */
export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',');
}
