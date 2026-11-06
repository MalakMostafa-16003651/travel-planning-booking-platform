/** Team agreement: blog post statuses. */
export enum PostStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}

export const BLOG_PAGE_SIZE = 10; // GEN-05
export const MAX_TAGS_PER_POST = 5; // BLG-08
export const MAX_TAG_LENGTH = 30; // BLG-08
export const EXCERPT_LENGTH = 200; // BLG-09 search results show an excerpt.

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
