import { detectImageExtension } from '../common/files/image-type';

export const MAX_HOTEL_PHOTOS = 5; // GEN-08
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // GEN-08

/** GEN-08: the file's own bytes decide its type, via the shared sniffer airlines' logo upload uses. */
export function detectPhotoContentType(buffer: Buffer): 'image/jpeg' | 'image/png' | null {
  const extension = detectImageExtension(buffer);
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg') return 'image/jpeg';
  return null;
}
