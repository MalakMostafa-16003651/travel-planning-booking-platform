import type { Page } from "../hotel-search/types";

export interface HotelPhoto {
  _id: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  url: string;
}

export interface CancellationTier {
  daysBeforeCheckIn: number;
  refundPercentage: number;
}

export interface ReviewAuthor {
  userId: string | null;
  name: string;
}

export interface ReviewReply {
  text: string;
  repliedAt: string;
  editedAt?: string;
}

export interface Review {
  reviewId: string;
  hotelId: string;
  rating: number;
  comment: string | null;
  isHidden: boolean;
  author: ReviewAuthor;
  reply: ReviewReply | null;
  createdAt: string;
  updatedAt: string;
}

export interface HotelReviewsPage {
  items: Review[];
  page: number;
  pageSize: number;
  total: number;
  averageRating: number | null;
  ratingCount: number;
}

export interface AvailableRoom {
  roomId: string;
  name: string;
  type?: string;
  beds?: number;
  capacity: number;
  pricePerNight: number;
  totalStayPrice: number;
  currency: string;
}

export interface HotelDetail {
  hotelId: string;
  name: string;
  city: string;
  countryCode: string;
  address: string;
  description: string | null;
  starClass?: number;
  amenities?: string[];
  isActive: boolean;
  checkInTime: string;
  checkOutTime: string;
  cancellationTiers: CancellationTier[];
  photos: HotelPhoto[];
  averageRating: number | null;
  ratingCount: number;
  reviews: HotelReviewsPage | null;
  availableRooms: Page<AvailableRoom> | null;
}
