import Link from 'next/link';
import { blogHref } from './format';

/** BLG-08: every tag is a link to the published posts with that tag. */
export function TagList({ tags, label = 'Tags' }: { tags: string[]; label?: string }) {
  if (tags.length === 0) return null;
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-wrap gap-2 p-0">
      {tags.map(tag => (
        <li key={tag}>
          <Link
            href={blogHref({ tag })}
            aria-label={`${tag}, show posts tagged ${tag}`}
            className="inline-flex min-h-9 items-center rounded-full border border-primary/25 bg-primary/10 px-3 text-sm font-semibold text-ink! no-underline hover:border-primary"
          >
            <span aria-hidden="true">#</span>{tag}
          </Link>
        </li>
      ))}
    </ul>
  );
}
