import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Pagination, firstParam, pageCount, pageHref, readPage, type SearchParams } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { buttonClassName } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/error-alert';
import { loginHref } from '@/config/routes';
import { LocalTime, MarkAllReadButton, MarkReadButton } from '@/features/notifications/inbox-actions';
import { loadInbox } from '@/features/notifications/server';
import { notificationTypeLabels } from '@/features/notifications/types';
import { getServerSession } from '@/lib/api/server-session';

// Rendering: dynamic SSR. Each person's private inbox, read fresh on every request and never cached.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Notifications', robots: { index: false } };

const PATH = '/notifications';

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const page = readPage(params);
  const unreadOnly = firstParam(params, 'show') === 'unread';
  const returnTo = pageHref(PATH, params, page);
  if (!(await getServerSession())) redirect(loginHref(returnTo));

  const result = await loadInbox(page, unreadOnly, returnTo);
  const tab = (label: string, show: boolean) => (
    <Link
      href={show ? `${PATH}?show=unread` : PATH}
      aria-current={unreadOnly === show ? 'page' : undefined}
      className={`rounded-control border px-3 py-2 text-sm font-semibold no-underline ${unreadOnly === show ? 'border-primary bg-primary text-white' : 'border-border text-ink hover:border-primary'}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="page-container page-content stack content-start">
      <div>
        <h1 className="m-0">Notifications</h1>
        <p className="muted mb-0">
          {result.kind === 'ok' && result.data.unreadCount > 0
            ? `${result.data.unreadCount} unread. Newest first.`
            : 'Updates about your bookings and account, newest first.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Show" className="flex gap-2">{tab('All', false)}{tab('Unread', true)}</nav>
        {result.kind === 'ok' && result.data.unreadCount > 0 && <MarkAllReadButton />}
      </div>

      {result.kind === 'error' && (
        <div className="grid justify-items-start gap-4">
          <ErrorAlert title="Notifications could not be loaded" message={result.message} />
          <Link href={returnTo} className={buttonClassName('secondary')}>Try again</Link>
        </div>
      )}

      {result.kind === 'ok' && (result.data.items.length === 0 ? (
        result.data.total > 0 ? (
          <EmptyState title="This page is empty" description="There are fewer notifications than this page number." action={<Link href={pageHref(PATH, params, 1)} className={buttonClassName('secondary')}>Go to the first page</Link>} />
        ) : (
          <EmptyState
            title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}
            description={unreadOnly ? 'You are all caught up.' : 'Booking, refund and account updates will appear here.'}
            action={unreadOnly ? <Link href={PATH} className={buttonClassName('secondary')}>Show all</Link> : undefined}
          />
        )
      ) : (
        <div className="grid gap-4">
          <ul className="m-0 grid list-none gap-3 p-0" aria-label={unreadOnly ? 'Unread notifications' : 'Notifications'}>
            {result.data.items.map(item => (
              <li key={item.notificationId} className={`flex flex-wrap items-start justify-between gap-3 rounded-card border p-4 ${item.isRead ? 'border-border bg-card' : 'border-primary/40 bg-primary/5'}`}>
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{notificationTypeLabels[item.type] ?? item.type}</span>
                    {!item.isRead && <Badge tone="info">Unread</Badge>}
                  </div>
                  <p className="m-0 text-body [overflow-wrap:anywhere]">{item.message}</p>
                  <p className="m-0 text-sm text-muted"><LocalTime iso={item.createdAt} /></p>
                </div>
                {!item.isRead && <MarkReadButton notificationId={item.notificationId} />}
              </li>
            ))}
          </ul>
          <Pagination
            label="Notification pages"
            page={result.data.page}
            totalPages={pageCount(result.data)}
            total={result.data.total}
            pageSize={result.data.pageSize}
            hrefForPage={next => pageHref(PATH, params, next)}
          />
        </div>
      ))}
    </div>
  );
}
