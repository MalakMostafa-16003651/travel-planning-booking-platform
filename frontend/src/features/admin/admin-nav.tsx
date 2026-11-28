import Link from 'next/link';

/**
 * Admin sections that exist so far. Each new admin page adds itself here, so the navigation never
 * links to a page that has not been built yet.
 */
export const adminSections = [
  { href: '/admin/accounts', label: 'Accounts', description: 'Search every account, suspend or reactivate users and moderators, and set temporary passwords.', ids: 'ACC-14, ACC-16, ACC-07a' },
  { href: '/admin/reports', label: 'Reports', description: 'Review what travelers reported, then dismiss the report or hide or delete the content.', ids: 'GEN-09, GEN-10' },
  { href: '/admin/content', label: 'Content', description: 'Hide, unhide or delete any post, comment, review or public itinerary, with or without a report.', ids: 'GEN-10' },
] as const;

export function AdminNav({ current }: { current?: string }) {
  return (
    <nav aria-label="Administration sections" className="flex flex-wrap items-start gap-2 border-b border-border pb-4">
      {[{ href: '/admin', label: 'Overview' }, ...adminSections].map(section => (
        <Link
          key={section.href}
          href={section.href}
          aria-current={current === section.href ? 'page' : undefined}
          className={`rounded-control border px-3 py-2 text-sm font-semibold no-underline ${current === section.href ? 'border-primary bg-primary text-white' : 'border-border text-ink hover:border-primary hover:text-primary'}`}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
