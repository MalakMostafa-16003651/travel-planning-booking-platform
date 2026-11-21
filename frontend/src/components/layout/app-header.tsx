import Link from "next/link";
import { Compass } from "lucide-react";
import type { ReactNode } from "react";
import { buttonClassName } from "@/components/ui/button";

export function AppHeader({ notificationSlot, accountSlot }: { notificationSlot?: ReactNode; accountSlot?: ReactNode }) {
  return (
    <>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <header className="site-header">
        <div className="page-container site-header-inner">
          <Link href="/" className="brand" aria-label="Travel Planning, home">
            <span className="brand-symbol"><Compass size={24} strokeWidth={1.6} aria-hidden="true" /></span>
            <span>Travel Planning<span className="block text-sm font-normal tracking-normal text-muted">&amp; Booking</span></span>
          </Link>
          <nav aria-label="Account" className="header-actions">
            {notificationSlot}
            {accountSlot ?? <Link href="/login" className={buttonClassName("secondary")}>Sign in</Link>}
          </nav>
        </div>
      </header>
    </>
  );
}
