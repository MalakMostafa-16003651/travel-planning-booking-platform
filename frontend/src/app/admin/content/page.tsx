import type { Metadata } from 'next';
import { enumParam, firstParam, type SearchParams } from '@/components/data-table';
import { AdminNav } from '@/features/admin/admin-nav';
import { ContentModeration } from '@/features/admin/content-moderation';
import { isObjectId } from '@/features/admin/moderation-types';
import { AdminAccessDenied } from '@/features/admin/page-states';
import { requireAdmin } from '@/features/admin/server';

// Rendering: dynamic SSR shell with a client form. Each action is a fresh admin-only API call.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Content moderation', robots: { index: false } };

const PATH = '/admin/content';

export default async function AdminContentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const type = enumParam(params, 'type', ['post', 'comment', 'review', 'itinerary'] as const);
  const id = firstParam(params, 'id');
  const query = new URLSearchParams();
  if (type) query.set('type', type);
  if (id) query.set('id', id);
  if (!(await requireAdmin(query.size ? `${PATH}?${query}` : PATH))) return <AdminAccessDenied />;

  return (
    <div className="page-container page-content stack content-start">
      <div>
        <p className="eyebrow">Administration</p>
        <h1 className="m-0">Content moderation</h1>
        <p className="muted mb-0">Hide, unhide or delete a blog post, comment, hotel review or public itinerary, whether or not anyone reported it. Hidden content stays visible to its author and administrators. Every action is audited and closes the item&apos;s open reports.</p>
      </div>
      <AdminNav current={PATH} />
      <ContentModeration initialType={type} initialId={id && isObjectId(id) ? id : ''} />
    </div>
  );
}
