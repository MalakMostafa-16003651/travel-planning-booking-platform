import { Suspense } from 'react';
import { HomeContent } from '@/components/layout/home-content';
import { LoadingState } from '@/components/ui/loading-state';
import { HomeActions } from '@/features/auth/home-actions';
import { BlogStoryPreviews } from '@/features/blog';
import { FlightSearch } from '@/features/flights/flight-search';
import { HotelSearch } from '@/features/hotels/hotel-search/HotelSearch';
import { PublicItinerariesTeaser } from '@/features/itineraries/public-itineraries-teaser';

// Public itinerary and story visibility are checked on each request.
export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <>
      <section className="hero" aria-labelledby="home-heading">
        <div className="max-w-2xl">
          <h1 id="home-heading">Plan your next trip.</h1>
          <p className="hero-description">Search flights and stays, or get ideas from other travelers’ itineraries and stories.</p>
          <HomeActions />
        </div>
      </section>
      <HomeContent
        flightSearch={<FlightSearch variant="home" />}
        hotelSearch={<HotelSearch variant="home" />}
        itineraries={
          <Suspense fallback={<LoadingState label="Loading public itineraries…" />}>
            <PublicItinerariesTeaser />
          </Suspense>
        }
        stories={
          <Suspense fallback={<LoadingState label="Loading travel stories…" />}>
            <BlogStoryPreviews />
          </Suspense>
        }
      />
    </>
  );
}
