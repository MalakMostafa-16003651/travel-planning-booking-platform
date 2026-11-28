import { Search } from 'lucide-react';
import { buttonClassName } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BLOG_LIMITS } from './types';

/**
 * BLG-09: a plain GET form to /blog, so the keyword lives in the URL and works without JavaScript.
 * The current tag filter is kept as a hidden field; a new search starts again at page 1.
 */
export function SearchForm({ q, tag }: { q: string; tag: string }) {
  return (
    <form action="/blog" method="get" role="search" className="flex flex-wrap items-end gap-3">
      <div className="grid min-w-0 flex-1 basis-64 gap-2">
        <label htmlFor="blog-search" className="text-sm font-semibold text-ink">Search stories</label>
        <Input id="blog-search" name="q" type="search" defaultValue={q} maxLength={BLOG_LIMITS.searchMax} placeholder="Title, tag or author name" />
      </div>
      {tag && <input type="hidden" name="tag" value={tag} />}
      <button type="submit" className={buttonClassName('primary')}><Search size={18} aria-hidden="true" />Search</button>
    </form>
  );
}
