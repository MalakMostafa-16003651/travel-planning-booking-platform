import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { BlogService } from './blog.service';
import { PageQueryDto, TagParamDto } from './dto/blog-post.dto';

@ApiTags('Blog')
@Controller('tags')
export class TagsController {
  constructor(private readonly blog: BlogService) {}

  @Get(':tag/posts')
  @ApiOperation({ summary: 'BLG-08: published posts with a tag', description: 'Guests allowed. Newest first, page size 10.' })
  @ApiOkResponse({ description: '{ items, page, pageSize, total, totalPages }' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid tag or page.' })
  listByTag(@Param() params: TagParamDto, @Query() query: PageQueryDto) {
    return this.blog.listByTag(params.tag, query.page);
  }
}
