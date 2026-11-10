import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types, isValidObjectId } from 'mongoose';
import { DELETED_USER_NAME } from '../blog/blog.rules';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import { HotelsService } from '../hotels/hotels.service';
import { UsersService } from '../users/users.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewReplyDto } from './dto/review-reply.dto';
import { HotelReviewsPageDto, ReviewDto } from './dto/review-response.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { Review, ReviewDocument } from './schemas/review.schema';

export const REVIEWS_PAGE_SIZE = 10; // GEN-05
const DUPLICATE_KEY = 11000;

export interface Viewer {
  userId: string;
  role: UserRole;
}

export interface RatingStats {
  averageRating: number;
  ratingCount: number;
}

function roundRating(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private readonly reviews: Model<ReviewDocument>,
    private readonly hotelBookings: HotelBookingsService,
    private readonly hotels: HotelsService,
    private readonly users: UsersService,
  ) {}

  /** HTL-23: one review per Completed reservation of the caller. Another user's reservation is 404. */
  async create(hotelBookingId: string, input: CreateReviewDto, viewer: Viewer): Promise<ReviewDto> {
    const booking = await this.hotelBookings.getMine(hotelBookingId, viewer.userId);
    if (booking.status !== BookingStatus.COMPLETED) {
      throw new ConflictException('Only a completed stay can be reviewed');
    }
    try {
      const review = await this.reviews.create({
        userId: booking.userId,
        hotelId: booking.hotelId,
        hotelBookingId: booking._id,
        rating: input.rating,
        comment: input.comment ?? null,
      });
      return this.toResponse(review);
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) throw new ConflictException('This reservation already has a review');
      throw error;
    }
  }

  /** HTL-23: the author changes the rating and/or the text. */
  async update(reviewId: string, input: UpdateReviewDto, viewer: Viewer): Promise<ReviewDto> {
    const changes: Partial<Pick<Review, 'rating' | 'comment'>> = {};
    if (input.rating !== undefined) changes.rating = input.rating;
    if (input.comment !== undefined) changes.comment = input.comment;
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException({ message: 'Validation failed', errors: { rating: ['Provide a rating or a comment to change'] } });
    }
    const review = await this.getOwned(reviewId, viewer);
    Object.assign(review, changes);
    await review.save();
    return this.toResponse(review);
  }

  /** HTL-23: the author deletes their review; the hotel's rating follows on the next read. */
  async remove(reviewId: string, viewer: Viewer): Promise<void> {
    const review = await this.getOwned(reviewId, viewer);
    await this.reviews.deleteOne({ _id: review._id }).exec();
  }

  /**
   * HTL-24: newest first, page size 10. Same visibility rule as blog comments (GEN-10): a hidden
   * review is listed only for its author and admins. The average and count use visible reviews only.
   * An unknown or deactivated hotel is 404, exactly like the hotel detail (ACC-15).
   */
  async listForHotel(hotelId: string, page: number, viewer?: Viewer): Promise<HotelReviewsPageDto> {
    const hotel = await this.hotels.getById(hotelId, viewer);
    const filter: QueryFilter<Review> = { hotelId: hotel._id };
    if (viewer?.role !== UserRole.ADMIN) {
      filter.$or = viewer ? [{ isHidden: false }, { userId: new Types.ObjectId(viewer.userId) }] : [{ isHidden: false }];
    }
    const [reviews, total, stats] = await Promise.all([
      this.reviews.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * REVIEWS_PAGE_SIZE).limit(REVIEWS_PAGE_SIZE).exec(),
      this.reviews.countDocuments(filter).exec(),
      this.getRatingStats([hotel._id.toString()]),
    ]);
    const names = await this.users.getDisplayNames(reviews.map((review) => review.userId.toString()));
    const rating = stats.get(hotel._id.toString());
    return {
      items: reviews.map((review) => this.shape(review, names)),
      page,
      pageSize: REVIEWS_PAGE_SIZE,
      total,
      averageRating: rating?.averageRating ?? null,
      ratingCount: rating?.ratingCount ?? 0,
    };
  }

  // HTL-26 (bonus): one reply per review by a HOTEL_MODERATOR assigned to the review's hotel.

  /**
   * 404 unknown review; 403 if the moderator is not assigned to that hotel (Person 5's
   * HotelsService.getAssignedHotelId, reused); 409 if the review is hidden or already has a reply.
   * The write is conditional on "visible and no reply yet", so concurrent replies store exactly one.
   */
  async reply(reviewId: string, input: ReviewReplyDto, moderatorId: string): Promise<ReviewDto> {
    const review = await this.getForHotelModerator(reviewId, moderatorId);
    if (review.isHidden) throw new ConflictException('A hidden review cannot be replied to');
    if (review.reply) throw new ConflictException('This review already has a reply');
    const replied = await this.reviews.findOneAndUpdate(
      { _id: review._id, isHidden: false, reply: null },
      { $set: { reply: { text: input.text, moderatorId: new Types.ObjectId(moderatorId), repliedAt: new Date() } } },
      { returnDocument: 'after', runValidators: true },
    ).exec();
    if (!replied) {
      const latest = await this.reviews.findById(review._id).exec();
      if (!latest) throw new NotFoundException('Review not found');
      throw new ConflictException(latest.isHidden ? 'A hidden review cannot be replied to' : 'This review already has a reply');
    }
    return this.toResponse(replied);
  }

  /** Optional HTL-26 extra: the moderator who wrote the reply edits it (still assigned to the hotel). */
  async updateReply(reviewId: string, input: ReviewReplyDto, moderatorId: string): Promise<ReviewDto> {
    await this.getOwnReply(reviewId, moderatorId);
    const updated = await this.reviews.findOneAndUpdate(
      { _id: reviewId, 'reply.moderatorId': new Types.ObjectId(moderatorId) },
      { $set: { 'reply.text': input.text, 'reply.editedAt': new Date() } },
      { returnDocument: 'after', runValidators: true },
    ).exec();
    if (!updated) throw new NotFoundException('Reply not found');
    return this.toResponse(updated);
  }

  /** Optional HTL-26 extra: the moderator who wrote the reply removes it; the hotel may reply again. */
  async removeReply(reviewId: string, moderatorId: string): Promise<void> {
    await this.getOwnReply(reviewId, moderatorId);
    const removed = await this.reviews.updateOne(
      { _id: reviewId, 'reply.moderatorId': new Types.ObjectId(moderatorId) },
      { $set: { reply: null } },
    ).exec();
    if (removed.modifiedCount === 0) throw new NotFoundException('Reply not found');
  }

  // HTL-02/HTL-12 (Person 5 connects this): calculated on read, never stored on Hotel.

  /** Visible reviews only. Hotels without visible ratings are absent from the map. */
  async getRatingStats(hotelIds: string[]): Promise<Map<string, RatingStats>> {
    const ids = [...new Set(hotelIds.filter((id) => isValidObjectId(id)).map((id) => id.toLowerCase()))].map((id) => new Types.ObjectId(id));
    if (ids.length === 0) return new Map();
    const rows: { _id: Types.ObjectId; average: number; count: number }[] = await this.reviews.aggregate([
      { $match: { hotelId: { $in: ids }, isHidden: false } },
      { $group: { _id: '$hotelId', average: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]).exec();
    return new Map(rows.map((row) => [row._id.toString(), { averageRating: roundRating(row.average), ratingCount: row.count }]));
  }

  // GEN-09/GEN-10 (Person 2 connects these in ContentModerationService). No HTTP routes here.

  /** False for unknown or invalid ids. */
  async reviewExists(reviewId: string): Promise<boolean> {
    return isValidObjectId(reviewId) && await this.reviews.countDocuments({ _id: reviewId }).exec() > 0;
  }

  /** 404 if the review does not exist. */
  async setReviewHidden(reviewId: string, hidden: boolean): Promise<void> {
    const updated = isValidObjectId(reviewId)
      ? await this.reviews.findByIdAndUpdate(reviewId, { isHidden: hidden }, { returnDocument: 'after' }).exec()
      : null;
    if (!updated) throw new NotFoundException('Review not found');
  }

  /** 404 if the review does not exist. */
  async adminDeleteReview(reviewId: string): Promise<void> {
    const deleted = isValidObjectId(reviewId) ? await this.reviews.deleteOne({ _id: reviewId }).exec() : null;
    if (!deleted || deleted.deletedCount === 0) throw new NotFoundException('Review not found');
  }

  // Internals

  private async getOwned(reviewId: string, viewer: Viewer): Promise<ReviewDocument> {
    const review = await this.reviews.findById(reviewId).exec();
    if (!review) throw new NotFoundException('Review not found');
    if (review.userId.toString() !== viewer.userId) throw new ForbiddenException('You can only change your own reviews');
    return review;
  }

  /** HTL-26: 404 unknown review; 403 unless the moderator's single assigned hotel is the review's hotel. */
  private async getForHotelModerator(reviewId: string, moderatorId: string): Promise<ReviewDocument> {
    const review = await this.reviews.findById(reviewId).exec();
    if (!review) throw new NotFoundException('Review not found');
    const assignedHotelId = await this.hotels.getAssignedHotelId(moderatorId);
    if (!assignedHotelId.equals(review.hotelId)) throw new ForbiddenException('You can only reply to reviews of your own hotel');
    return review;
  }

  /** HTL-26: the reply must exist (404) and belong to this moderator (403). */
  private async getOwnReply(reviewId: string, moderatorId: string): Promise<ReviewDocument> {
    const review = await this.getForHotelModerator(reviewId, moderatorId);
    if (!review.reply) throw new NotFoundException('Reply not found');
    if (review.reply.moderatorId.toString() !== moderatorId) throw new ForbiddenException('You can only change your own reply');
    return review;
  }

  private async toResponse(review: ReviewDocument): Promise<ReviewDto> {
    return this.shape(review, await this.users.getDisplayNames([review.userId.toString()]));
  }

  /** ACC-12: the author id is returned only while the name is; a deactivated author is "Deleted user". */
  private shape(review: ReviewDocument, names: Map<string, string>): ReviewDto {
    const name = names.get(review.userId.toString());
    return {
      reviewId: review._id.toString(),
      hotelId: review.hotelId.toString(),
      rating: review.rating,
      comment: review.comment ?? null,
      isHidden: review.isHidden,
      author: name === undefined ? { userId: null, name: DELETED_USER_NAME } : { userId: review.userId.toString(), name },
      // HTL-26: the hotel's reply, without the moderator's identity.
      reply: review.reply ? { text: review.reply.text, repliedAt: review.reply.repliedAt, editedAt: review.reply.editedAt } : null,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    };
  }
}
