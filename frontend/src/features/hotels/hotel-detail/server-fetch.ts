import "server-only";
import { cookies } from "next/headers";
import { authCookies, backendUrl } from "@/lib/api/upstream";
import type { HotelDetail } from "./types";

export interface HotelDetailQuery {
  checkIn?: string;
  checkOut?: string;
  guests?: number;
}

/**
 * Public endpoint (OptionalAuthGuard), but forwards the viewer's cookies anyway: a signed-in
 * hotel moderator or admin can see a deactivated hotel, same as getServerSession's own pattern.
 */
export async function getHotelDetail(hotelId: string, query: HotelDetailQuery): Promise<HotelDetail | null> {
  const url = new URL(`/api/hotels/${hotelId}`, backendUrl());
  if (query.checkIn) url.searchParams.set("checkIn", query.checkIn);
  if (query.checkOut) url.searchParams.set("checkOut", query.checkOut);
  if (query.guests) url.searchParams.set("guests", String(query.guests));

  const jar = await cookies();
  const response = await fetch(url, {
    headers: { Cookie: authCookies(jar.toString()) },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Unable to load this hotel");
  return response.json() as Promise<HotelDetail>;
}
