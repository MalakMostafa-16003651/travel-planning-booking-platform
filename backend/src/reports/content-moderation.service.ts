import { Injectable, NotFoundException } from '@nestjs/common';
import { BlogService } from '../blog/blog.service';
import { CommentsService } from '../blog/comments.service';
import { ItinerariesService } from '../itineraries/itineraries.service';
import { ReviewsService } from '../reviews/reviews.service';
import { ReportTargetType } from './report.enums';

/**
 * GEN-10: hides, unhides and deletes content through the operations each owner exports.
 * Posts and comments are Person 8's (BlogService, CommentsService), reviews Person 6's
 * (ReviewsService) and itineraries Person 7's (ItinerariesService, PR #81).
 */
@Injectable()
export class ContentModerationService {
  constructor(
    private readonly posts: BlogService,
    private readonly comments: CommentsService,
    private readonly reviews: ReviewsService,
    private readonly itineraries: ItinerariesService,
  ) {}

  /**
   * GEN-09: whether the item can be reported. For itineraries only PUBLIC ones count:
   * nobody but the owner can see a private itinerary (ACC-11).
   */
  exists(type: ReportTargetType, id: string): Promise<boolean> {
    switch (type) {
      case ReportTargetType.POST: return this.posts.postExists(id);
      case ReportTargetType.COMMENT: return this.comments.commentExists(id);
      case ReportTargetType.REVIEW: return this.reviews.reviewExists(id);
      case ReportTargetType.ITINERARY: return this.itineraries.itineraryExists(id);
    }
  }

  /**
   * GEN-10 direct moderation (without a report). Admins have no general access to private
   * itineraries (ACC-11), so a private or unknown itinerary is reported as not found.
   */
  async assertDirectlyModeratable(type: ReportTargetType, id: string): Promise<void> {
    if (type === ReportTargetType.ITINERARY && !(await this.itineraries.itineraryExists(id))) {
      throw new NotFoundException('Itinerary not found');
    }
  }

  /** Hidden content stays visible to its author and admins only (enforced by the owner). 404 if it does not exist. */
  async setHidden(type: ReportTargetType, id: string, hidden: boolean): Promise<void> {
    switch (type) {
      case ReportTargetType.POST: return this.posts.setPostHidden(id, hidden).then(() => undefined);
      case ReportTargetType.COMMENT: return this.comments.setCommentHidden(id, hidden).then(() => undefined);
      case ReportTargetType.REVIEW: return this.reviews.setReviewHidden(id, hidden).then(() => undefined);
      case ReportTargetType.ITINERARY: return this.itineraries.setItineraryHidden(id, hidden);
    }
  }

  /** Deletes through the owner, so its own clean-up runs (comments, likes, images). 404 if it does not exist. */
  async delete(type: ReportTargetType, id: string): Promise<void> {
    switch (type) {
      case ReportTargetType.POST: return this.posts.adminDeletePost(id).then(() => undefined);
      case ReportTargetType.COMMENT: return this.comments.adminDeleteComment(id).then(() => undefined);
      case ReportTargetType.REVIEW: return this.reviews.adminDeleteReview(id).then(() => undefined);
      case ReportTargetType.ITINERARY: return this.itineraries.adminDeleteItinerary(id);
    }
  }
}
