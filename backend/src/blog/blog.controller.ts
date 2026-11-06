import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { OptionalAuthGuard } from '../itineraries/optional-auth.guard';
import { BlogService } from './blog.service';
import { CreateBlogPostDto, ListPostsQueryDto, PageQueryDto, PostIdParamDto, UpdateBlogPostDto } from './dto/blog-post.dto';

@ApiTags('Blog')
@Controller('posts')
export class BlogController {
  constructor(private readonly blog: BlogService) {}

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
    description: 'Guests see published posts. The author also sees drafts and hidden posts; admins also see hidden posts (GEN-10). Others get 404.',
  })
  @ApiOkResponse({ description: 'The post.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such post you may read.' })
  findOne(@Param() params: PostIdParamDto, @Req() request: AuthenticatedRequest) {
    return this.blog.findOne(params.id, request.user);
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
}
