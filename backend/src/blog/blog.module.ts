import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { OptionalAuthGuard } from '../itineraries/optional-auth.guard';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AuthorsController } from './authors.controller';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { BlogPost, BlogPostSchema } from './schemas/blog-post.schema';
import { TagsController } from './tags.controller';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: BlogPost.name, schema: BlogPostSchema },
      // Read-only: author name, status and join date.
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [BlogController, TagsController, AuthorsController],
  // OptionalAuthGuard is Person 7's guest-or-user guard, reused unchanged.
  providers: [BlogService, OptionalAuthGuard],
  // Person 2 (moderation, GEN-09/GEN-10) uses setPostHidden, adminDeletePost and postExists.
  exports: [BlogService],
})
export class BlogModule {}
