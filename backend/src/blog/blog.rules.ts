/** Team agreement: blog post statuses. */
export enum PostStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

export const BLOG_PAGE_SIZE = 10; // GEN-05
export const MAX_TAGS_PER_POST = 5; // BLG-08
export const MAX_TAG_LENGTH = 30; // BLG-08
export const EXCERPT_LENGTH = 200; // BLG-09 search results show an excerpt.
export const MAX_COMMENT_LENGTH = 500; // BLG-05
export const MAX_IMAGES_PER_POST = 5; // GEN-08
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // GEN-08

export const TITLE_LENGTH = { min: 3, max: 150 };
export const CONTENT_LENGTH = { min: 1, max: 20000 };

/** ACC-12: a deactivated or missing author is shown without any identity. */
export const DELETED_USER_NAME = 'Deleted user';

export function excerpt(content: string): string {
  return content.length <= EXCERPT_LENGTH ? content : `${content.slice(0, EXCERPT_LENGTH).trimEnd()}…`;
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** GEN-08: JPG or PNG, decided by the file's first bytes, never by the client's filename or mimetype. */
export function detectImageType(buffer: Buffer): 'image/jpeg' | 'image/png' | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length >= png.length && png.every((byte, index) => buffer[index] === byte)) return 'image/png';
  return null;
}
