import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export const AIRLINE_LOGO_FIELD = 'logo';
export const AIRLINE_LOGO_MAX_BYTES = 5 * 1024 * 1024; // GEN-08: 5 MB

/** Logos live on the server in backend/uploads/airline-logos (the folder is git-ignored). */
const logoDirectory = () => join(process.cwd(), 'uploads', 'airline-logos');

export async function writeAirlineLogo(airlineId: string, extension: 'png' | 'jpg', data: Buffer): Promise<void> {
  await fs.mkdir(logoDirectory(), { recursive: true });
  // GEN-08: one logo per airline, so remove the other format first.
  await fs.rm(join(logoDirectory(), `${airlineId}.${extension === 'png' ? 'jpg' : 'png'}`), { force: true });
  await fs.writeFile(join(logoDirectory(), `${airlineId}.${extension}`), data);
}

export async function readAirlineLogo(airlineId: string): Promise<{ data: Buffer; mimeType: string } | null> {
  for (const [extension, mimeType] of [['png', 'image/png'], ['jpg', 'image/jpeg']] as const) {
    try {
      return { data: await fs.readFile(join(logoDirectory(), `${airlineId}.${extension}`)), mimeType };
    } catch {
      // not in this format; try the next one
    }
  }
  return null;
}
