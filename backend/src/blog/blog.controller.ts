import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Req, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiConsumes, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiPayloadTooLargeResponse, ApiProduces, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { Types } from 'mongoose';
import { UserRole } from '../common/enums/user-role.enum';
import { OptionalAuthGuard } from '../itineraries/optional-auth.guard';
import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_POST } from './blog.rules';
import { BlogService } from './blog.service';
import { CommentsService } from './comments.service';
import { AttachPostItineraryDto, CreateBlogPostDto, ListPostsQueryDto, PageQueryDto, PostIdParamDto, PostImageParamsDto, UpdateBlogPostDto } from './dto/blog-post.dto';
import { CreateCommentDto } from './dto/comment.dto';
import { LikesService } from './likes.service';
import { PostImagesService, UploadedImage } from './post-images.service';

@ApiTags('Blog')
@Controller('posts')
export class BlogController {
  constructor(
    private readonly blog: BlogService,
    private readonly comments: CommentsService,
    private readonly likes: LikesService,
    private readonly images: PostImagesService,
  ) {}

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'BLG-01: create a post (DRAFT, or PUBLISHED to publish)', description: 'Title and body required; up to 5 tags (BLG-08). Images are added with BLG-10.' })
  @ApiCreatedResponse({ description: 'The post.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid body.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Only role USER can write posts.' })
  create(@Body() dto: CreateBlogPostDto, @Req() request: AuthenticatedRequest) {
    return this.blog.create(dto, request.user!);
  }

  @Get()
  @ApiOperation({
    summary: 'BLG-02/BLG-09: browse or search published posts',
    description: 'Guests allowed. Page size 10. Without q: newest first, optionally filtered by tag. With q: keyword in title, tags or author name, ordered by likes + comments, newest first on ties. Items show title, author, date and an excerpt; no results is an empty items list.',
  })
  @ApiOkResponse({ description: '{ items, page, pageSize, total, totalPages }' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid query.' })
  list(@Query() query: ListPostsQueryDto) {
    return this.blog.listPublic(query);
  }

  // Declared before ':id', or "mine" would be read as an id.
  @Get('mine')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'BLG-03: list my posts, drafts included', description: 'Title, status, date, like count and comment count. Newest first, page size 10.' })
  @ApiOkResponse({ description: '{ items, page, pageSize, total, totalPages }' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Only role USER has posts.' })
  listMine(@Query() query: PageQueryDto, @Req() request: AuthenticatedRequest) {
    return this.blog.listMine(request.user!, query.page);
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'BLG-02: view a post',
    description: 'Guests see published posts. The author also sees drafts and hidden posts; admins also see hidden posts (GEN-10). Others get 404. Includes the like count, likedByMe, and the first page of comments (oldest first); later pages come from GET /api/posts/{id}/comments.',
  })
  @ApiOkResponse({ description: 'The post.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such post you may read.' })
  async findOne(@Param() params: PostIdParamDto, @Req() request: AuthenticatedRequest) {
    const post = await this.blog.findOne(params.id, request.user);
    const [comments, likedByMe] = await Promise.all([
      this.comments.listForPost(params.id, 1, request.user),
      this.likes.hasLiked(new Types.ObjectId(post.postId), request.user),
    ]);
    return { ...post, likedByMe, comments };
  }

  @Patch(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'BLG-04/BLG-08: edit my post (title, body, tags, status)' })
  @ApiOkResponse({ description: 'The post.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id or body.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Not your post, or role not USER.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such post you may read.' })
  update(@Param() params: PostIdParamDto, @Body() dto: UpdateBlogPostDto, @Req() request: AuthenticatedRequest) {
    return this.blog.update(params.id, dto, request.user!);
  }

  @Patch(':id/itinerary')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'BLG-13 (bonus): attach one of your own public itineraries to your post, or detach it with null' })
  @ApiOkResponse({ description: 'The post, with its itinerary summary.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id, or the itinerary is not one of your own public itineraries.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Not your post, or role not USER.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such post you may read.' })
  attachItinerary(@Param() params: PostIdParamDto, @Body() dto: AttachPostItineraryDto, @Req() request: AuthenticatedRequest) {
    return this.blog.update(params.id, Object.assign(new UpdateBlogPostDto(), { itineraryId: dto.itineraryId }), request.user!);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'BLG-04: delete my post' })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Not your post, or role not USER.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such post you may read.' })
  remove(@Param() params: PostIdParamDto, @Req() request: AuthenticatedRequest) {
    return this.blog.remove(params.id, request.user!);
  }

  @Post(':id/comments')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'BLG-05: comment on a published post', description: 'Non-empty, at most 500 characters.' })
  @ApiCreatedResponse({ description: 'The comment.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id or body.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Only role USER can comment.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such published post.' })
  addComment(@Param() params: PostIdParamDto, @Body() dto: CreateCommentDto, @Req() request: AuthenticatedRequest) {
    return this.comments.create(params.id, dto, request.user!);
  }

  @Get(':id/comments')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'BLG-05: list the comments of a post (oldest first)', description: 'Guests allowed. Page size 10. Hidden comments only for their author and admins (GEN-10).' })
  @ApiOkResponse({ description: '{ items, page, pageSize, total, totalPages }' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id or page.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such post you may read.' })
  listComments(@Param() params: PostIdParamDto, @Query() query: PageQueryDto, @Req() request: AuthenticatedRequest) {
    return this.comments.listForPost(params.id, query.page, request.user);
  }

  @Post(':id/like')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'BLG-06: like a post (once)' })
  @ApiCreatedResponse({ description: '{ liked: true, likesCount }' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Only role USER can like.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such published post.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Already liked.' })
  like(@Param() params: PostIdParamDto, @Req() request: AuthenticatedRequest) {
    return this.likes.like(params.id, request.user!);
  }

  @Delete(':id/like')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'BLG-06: remove my like' })
  @ApiOkResponse({ description: '{ liked: false, likesCount }' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Only role USER can like.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'You have not liked this post.' })
  unlike(@Param() params: PostIdParamDto, @Req() request: AuthenticatedRequest) {
    return this.likes.unlike(params.id, request.user!);
  }

  @Post(':id/images')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  @ApiCookieAuth('accessToken')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['image'], properties: { image: { type: 'string', format: 'binary' } } } })
  @ApiOperation({
    summary: 'BLG-10/GEN-08: attach an image to my post',
    description: `JPG or PNG (checked by file content), at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB, at most ${MAX_IMAGES_PER_POST} per post. Returns the post with its image URLs.`,
  })
  @ApiCreatedResponse({ description: 'The post.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Missing file, not a JPG or PNG, or 5 images already.' })
  @ApiPayloadTooLargeResponse({ type: ApiErrorDto, description: 'File larger than 5 MB.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Not your post, or role not USER.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such post you may read.' })
  addImage(@Param() params: PostIdParamDto, @UploadedFile() file: UploadedImage | undefined, @Req() request: AuthenticatedRequest) {
    return this.images.addImage(params.id, file, request.user!);
  }

  @Get(':id/images/:imageId')
  @UseGuards(OptionalAuthGuard)
  @ApiProduces('image/jpeg', 'image/png')
  @ApiOperation({ summary: 'BLG-10/GEN-08: view an image of a post', description: 'Same visibility as the post: drafts and hidden posts only for those allowed to read them.' })
  @ApiOkResponse({ description: 'Image bytes.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such image you may see.' })
  async getImage(@Param() params: PostImageParamsDto, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response): Promise<StreamableFile> {
    const image = await this.images.getImage(params.id, params.imageId, request.user);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-cache');
    return new StreamableFile(image.data, { type: image.contentType, length: image.data.length });
  }

  @Delete(':id/images/:imageId')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'BLG-10: remove an image from my post' })
  @ApiOkResponse({ description: 'The post.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Not your post, or role not USER.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such post or image.' })
  removeImage(@Param() params: PostImageParamsDto, @Req() request: AuthenticatedRequest) {
    return this.images.removeImage(params.id, params.imageId, request.user!);
  }
}
