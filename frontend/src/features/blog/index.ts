// Public exports of the blog feature for other owners. Pages inside the blog import the files directly.
// Malak's home page: <HomeContent stories={<BlogStoryPreviews />} /> (Server Component, optional `limit`, default 3).
export { BlogStoryPreviews } from './story-previews';
// Server Action that expires the cached public post lists. Call it after hiding or deleting a post (Arwa,
// GEN-10) and just before deactivating an account (Malak, ACC-12). From a Client Component import it from
// '@/features/blog/actions' instead, because this index also exports a Server Component.
export { refreshPublicBlog } from './actions';
export type { Author, Post, PostDetail, PostListItem, PostStatus } from './types';
