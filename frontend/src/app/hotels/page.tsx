import type { Metadata } from "next";
import { HotelResults } from "@/features/hotels/hotel-search/HotelResults";
import { HotelSearch } from "@/features/hotels/hotel-search/HotelSearch";
import { paramsToCriteria } from "@/features/hotels/hotel-search/format";
import type { HotelSearchCriteria } from "@/features/hotels/hotel-search/types";

// Rendering: dynamic. Results depend on URL query params and live room availability.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search hotels" };

type Raw = Record<string, string | string[] | undefined>;
const one = (value: Raw[string]) => (Array.isArray(value) ? value[0] : value);

export default async function HotelsPage({ searchParams }: { searchParams: Promise<Raw> }) {
  const raw = await searchParams;
  const criteria = paramsToCriteria(raw);
  const searched = Boolean((criteria.city || criteria.countryCode) && criteria.checkIn && criteria.checkOut && criteria.guests);
  const page = Math.max(1, Number(one(raw.page)) || 1);

  return (
    <div className="page-container page-content stack">
      <h1>Search hotels</h1>
      <HotelSearch variant="full" initialCriteria={criteria} />
      {searched && <HotelResults criteria={criteria as HotelSearchCriteria} page={page} />}
    </div>
  );
}
