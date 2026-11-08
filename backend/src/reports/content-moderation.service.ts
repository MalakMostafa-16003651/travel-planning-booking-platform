import { BadRequestException, Injectable } from '@nestjs/common';
import { BlogService } from '../blog/blog.service';
import { CommentsService } from '../blog/comments.service';
import { ReportTargetType } from './report.enums';

/**
 * GEN-10: hides, unhides and deletes content through the operations each owner exports.
 * Posts and comments are Person 8's (BlogService, CommentsService). Reviews (Person 6) and
 * itineraries (Person 7) are added here once their modules expose the same three operations.
 */
@Injectable()
export class ContentModerationService {
  constructor(
    private readonly posts: BlogService,
    private readonly comments: CommentsService,
  ) {}

  assertSupported(type: ReportTargetType): void {
    if (type === ReportTargetType.REVIEW || type === ReportTargetType.ITINERARY) {
      throw new BadRequestException(`Moderating ${type.toLowerCase()}s is not supported yet`);
    }
  }

  exists(type: ReportTargetType, id: string): Promise<boolean> {
    this.assertSupported(type);
    return type === ReportTargetType.POST ? this.posts.postExists(id) : this.comments.commentExists(id);
  }

  /** Hidden content stays visible to its author and admins only (enforced by the owner). 404 if it does not exist. */
  async setHidden(type: ReportTargetType, id: string, hidden: boolean): Promise<void> {
    this.assertSupported(type);
    if (type === ReportTargetType.POST) await this.posts.setPostHidden(id, hidden);
    else await this.comments.setCommentHidden(id, hidden);
  }

  /** Deletes through the owner, so its own clean-up runs (a post's comments, likes and images). 404 if it does not exist. */
  async delete(type: ReportTargetType, id: string): Promise<void> {
    this.assertSupported(type);
    if (type === ReportTargetType.POST) await this.posts.adminDeletePost(id);
    else await this.comments.adminDeleteComment(id);
  }
}
