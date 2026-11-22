export const passwordHint = '8–128 characters, including a letter and a number.';

export function passwordError(value: string): string | undefined {
  const length = [...value].length;
  if (length < 8 || length > 128 || !/\p{L}/u.test(value) || !/\p{Nd}/u.test(value)) {
    return 'Use 8–128 characters with at least one letter and one number.';
  }
}
