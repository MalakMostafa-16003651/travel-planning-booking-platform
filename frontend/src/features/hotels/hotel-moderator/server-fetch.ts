import "server-only";
import { cookies } from "next/headers";
import { authCookies, backendUrl } from "@/lib/api/upstream";
import type { MyHotel, ReservationsPage, RoomAvailabilityPage, RoomsPage } from "./types";

async function authedFetch(path: string): Promise<Response> {
  const jar = await cookies();
  return fetch(new URL(path, backendUrl()), {
    headers: { Cookie: authCookies(jar.toString()) },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
}

/** HTL-01: every moderator subpage starts here to learn which hotel it's managing. */
export async function getMyHotel(): Promise<MyHotel | null> {
  const response = await authedFetch("/api/hotels/me");
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error("Unable to load your hotel");
  return response.json() as Promise<MyHotel>;
}

export async function getOwnRooms(hotelId: string, page = 1): Promise<RoomsPage> {
  const response = await authedFetch(`/api/hotels/${hotelId}/rooms?page=${page}`);
  if (!response.ok) throw new Error("Unable to load your rooms");
  return response.json() as Promise<RoomsPage>;
}

export async function getOwnAvailability(hotelId: string, params: { from?: string; to?: string; page?: number } = {}): Promise<RoomAvailabilityPage> {
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.page) query.set("page", String(params.page));
  const response = await authedFetch(`/api/hotels/${hotelId}/availability?${query}`);
  if (!response.ok) throw new Error("Unable to load room availability");
  return response.json() as Promise<RoomAvailabilityPage>;
}

export async function getOwnReservations(hotelId: string, page = 1): Promise<ReservationsPage> {
  const response = await authedFetch(`/api/hotels/${hotelId}/reservations?page=${page}`);
  if (!response.ok) throw new Error("Unable to load reservations");
  return response.json() as Promise<ReservationsPage>;
}
