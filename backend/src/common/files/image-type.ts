/** GEN-08: decides the image type from the file's first bytes, never from its name or declared type. */
export function detectImageExtension(buffer: Buffer): 'png' | 'jpg' | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length >= png.length && png.every((byte, index) => buffer[index] === byte)) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  return null;
}
