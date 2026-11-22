'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { buttonClassName } from '@/components/ui/button';
import { roleWorkspaces } from '@/config/routes';
import { useSession } from './session-provider';

export function HomeActions() {
  const { user } = useSession();
  return user ? (
    <div className="hero-actions">
      <Link href={roleWorkspaces[user.role]} className={buttonClassName()}>
        Open workspace <ArrowRight size={18} aria-hidden="true" />
      </Link>
      <Link href="/account/profile" className={buttonClassName('secondary')}>Manage account</Link>
    </div>
  ) : (
    <div className="hero-actions">
      <Link href="/register" className={buttonClassName()}>
        Create an account <ArrowRight size={18} aria-hidden="true" />
      </Link>
      <Link href="/login" className={buttonClassName('secondary')}>Sign in</Link>
    </div>
  );
}
