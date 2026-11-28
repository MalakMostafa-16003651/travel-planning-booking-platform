import type { Metadata } from 'next';
import Link from 'next/link';
import { RequireSession } from '@/features/auth/require-session';
import { NewItinerary } from '@/features/itineraries/new-itinerary';

// Rendering: static shell + Client Component form. Only signed-in travelers (role USER) can
// create; RequireSession is the UX gate and the backend enforces the role again.
export const metadata: Metadata = { title: 'New itinerary', robots: { index: false } };

export default function NewItineraryPage() {
  return (
    <div className="stack mx-auto w-full max-w-3xl">
      <header>
        <Link href="/itineraries" className="text-sm">Your itineraries</Link>
        <h1 className="m-0 mt-3">New itinerary</h1>
        <p className="m-0 mt-2 text-muted">Start with the basics. You will add days, activities and budgets next.</p>
      </header>
      <RequireSession role="USER">
        <NewItinerary />
      </RequireSession>
    </div>
  );
}
