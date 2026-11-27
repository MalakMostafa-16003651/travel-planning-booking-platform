// Wire types for the blog API, copied from backend/src/blog (blog.service.ts toResponse/findPublicPosts/listMine,
// comments.service.ts shape, likes.service.ts) and backend/src/itineraries/dto/itinerary-response.dto.ts.
// Ids are endpoint-specific: postId, commentId, imageId, itineraryId, userId (never _id). Dates are ISO strings.
import type { ItinerarySummary } from '@/features/itineraries/types';

/** backend/src/blog/blog.rules.ts, repeated so the forms can explain the limits before the server refuses. */
export const BLOG_LIMITS = {
  titleMin: 3,
  titleMax: 150,
  contentMax: 20000,
  maxTags: 5,
  tagMax: 30,
  commentMax: 500,
  maxImages: 5,
  searchMax: 100,
} as const;

export type PostStatus = 'DRAFT' | 'PUBLISHED';

/** Standard list envelope, 1-based pages of ten (GEN-05). */
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** ACC-12: a deactivated or missing user comes back as { userId: null, name: 'Deleted user' }. */
export interface Author {
  userId: string | null;
  name: string;
}

/** GET /api/posts, GET /api/tags/:tag/posts and the author page's posts. Excerpt is at most 200 characters. */
export interface PostListItem {
  postId: string;
  title: string;
  excerpt: string;
  tags: string[];
  likesCount: number;
  commentsCount: number;
  publishedAt: string;
  author: Author;
}

/** GET /api/posts/mine (BLG-03): drafts included, no excerpt. */
export interface MyPostItem {
  postId: string;
  title: string;
  status: PostStatus;
  isHidden: boolean;
  tags: string[];
  likesCount: number;
  commentsCount: number;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PostImage {
  imageId: string;
  /** Same-origin `/api/posts/:id/images/:imageId`, so the browser loads it through the Next proxy with the viewer's cookies. */
  url: string;
  contentType: string;
  size: number;
  uploadedAt: string;
}

/**
 * BLG-12, BLG-13: the backend sends the full ItinerarySummaryDto, the same shape Kiki's itinerary
 * feature uses, so the blog shares her type (and her picker can show a post's saved itinerary).
 */
export type { ItinerarySummary };

export interface Comment {
  commentId: string;
  postId: string;
  content: string;
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
  author: Author;
}

/** POST/PATCH /api/posts and the image endpoints. */
export interface Post {
  postId: string;
  title: string;
  content: string;
  status: PostStatus;
  tags: string[];
  images: PostImage[];
  likesCount: number;
  commentsCount: number;
  isHidden: boolean;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  author: Author;
  /** BLG-13: only present when the attached itinerary is still the author's own visible public one. */
  itinerary: ItinerarySummary | null;
}

/** GET /api/posts/:id adds the viewer's like state and the first page of comments. */
export interface PostDetail extends Post {
  likedByMe: boolean;
  comments: Page<Comment>;
}

/** POST/DELETE /api/posts/:id/like */
export interface LikeState {
  liked: boolean;
  likesCount: number;
}

/** GET /api/authors/:id (BLG-12): `page` pages the posts, `itinerariesPage` the itineraries. */
export interface AuthorProfile {
  userId: string;
  name: string;
  joinedAt: string;
  posts: Page<PostListItem>;
  itineraries: Page<ItinerarySummary>;
}
