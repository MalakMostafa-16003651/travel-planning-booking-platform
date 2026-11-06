import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { BlogService } from './blog.service';
import { AuthorIdParamDto, PageQueryDto } from './dto/blog-post.dto';

@ApiTags('Blog')
@Controller('authors')
export class AuthorsController {
  constructor(private readonly blog: BlogService) {}

  @Get(':id')
  @ApiOperation({
    summary: "BLG-12: an author's public page",
    description: "Guests allowed. Name, join date and published posts (newest first, page size 10). The author's public itineraries come from Person 7's module (ITN-20).",
  })
  @ApiOkResponse({ description: '{ userId, name, joinedAt, posts }' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such author, or deactivated.' })
  getAuthor(@Param() params: AuthorIdParamDto, @Query() query: PageQueryDto) {
    return this.blog.getAuthor(params.id, query.page);
  }
}
