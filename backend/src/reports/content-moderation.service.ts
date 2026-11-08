import { BadRequestException, Injectable } from '@nestjs/common';
import { BlogService } from '../blog/blog.service';
import { CommentsService } from '../blog/comments.service';
import { ReviewsService } from '../reviews/reviews.service';
import { ReportTargetType } from './report.enums';

/**
 * GEN-10: hides, unhides and deletes content through the operations each owner exports.
 * Posts and comments are Person 8's (BlogService, CommentsService); reviews are Person 6's
 * (ReviewsService). Itineraries (Person 7) are added once their module exposes the same operations.
 */
@Injectable()
export class ContentModerationService {
  constructor(
    private readonly posts: BlogService,
    private readonly comments: CommentsService,
    private readonly reviews: ReviewsService,
  ) {}

  assertSupported(type: ReportTargetType): void {
    if (type === ReportTargetType.ITINERARY) {
      throw new BadRequestException(`Moderating ${type.toLowerCase()}s is not supported yet`);
    }
  }

  exists(type: ReportTargetType, id: string): Promise<boolean> {
    this.assertSupported(type);
    if (type === ReportTargetType.POST) return this.posts.postExists(id);
    if (type === ReportTargetType.REVIEW) return this.reviews.reviewExists(id);
    return this.comments.commentExists(id);
  }

  /** Hidden content stays visible to its author and admins only (enforced by the owner). 404 if it does not exist. */
  async setHidden(type: ReportTargetType, id: string, hidden: boolean): Promise<void> {
    this.assertSupported(type);
    if (type === ReportTargetType.POST) await this.posts.setPostHidden(id, hidden);
    else if (type === ReportTargetType.REVIEW) await this.reviews.setReviewHidden(id, hidden);
    else await this.comments.setCommentHidden(id, hidden);
  }

  /** Deletes through the owner, so its own clean-up runs (a post's comments, likes and images). 404 if it does not exist. */
  async delete(type: ReportTargetType, id: string): Promise<void> {
    this.assertSupported(type);
    if (type === ReportTargetType.POST) await this.posts.adminDeletePost(id);
    else if (type === ReportTargetType.REVIEW) await this.reviews.adminDeleteReview(id);
    else await this.comments.adminDeleteComment(id);
  }
}
