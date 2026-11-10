import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { OptionalAuthGuard } from '../itineraries/optional-auth.guard';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AuthorsController } from './authors.controller';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { LikesService } from './likes.service';
import { PostImagesService } from './post-images.service';
import { BlogPost, BlogPostSchema } from './schemas/blog-post.schema';
import { Comment, CommentSchema } from './schemas/comment.schema';
import { Like, LikeSchema } from './schemas/like.schema';
import { PostImage, PostImageSchema } from './schemas/post-image.schema';
import { TagsController } from './tags.controller';

@Module({
  imports: [
    AuthModule,
    ItinerariesModule,
    MongooseModule.forFeature([
      { name: BlogPost.name, schema: BlogPostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Like.name, schema: LikeSchema },
      { name: PostImage.name, schema: PostImageSchema },
      // Read-only: author name, status and join date.
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [BlogController, CommentsController, TagsController, AuthorsController],
  // OptionalAuthGuard is Person 7's guest-or-user guard, reused unchanged.
  providers: [BlogService, CommentsService, LikesService, PostImagesService, OptionalAuthGuard],
  // Person 2 (moderation, GEN-09/GEN-10): BlogService.setPostHidden/adminDeletePost/postExists and
  // CommentsService.setCommentHidden/adminDeleteComment/commentExists.
  exports: [BlogService, CommentsService],
})
export class BlogModule {}
