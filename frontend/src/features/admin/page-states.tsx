import Link from 'next/link';
import { buttonClassName } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';

export function AdminAccessDenied() {
  return (
    <div className="page-container page-content stack">
      <h1>Access denied</h1>
      <p>Only administrators can open this page.</p>
      <Link href="/">Back to home</Link>
    </div>
  );
}

export function AdminLoadFailed({ message, retryHref }: { message: string; retryHref: string }) {
  return (
    <div className="grid justify-items-start gap-4">
      <ErrorAlert title="The list could not be loaded" message={message} />
      <Link href={retryHref} className={buttonClassName('secondary')}>Try again</Link>
    </div>
  );
}
