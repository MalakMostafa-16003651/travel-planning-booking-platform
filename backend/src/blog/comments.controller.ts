import { Body, Controller, Delete, HttpCode, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCookieAuth, ApiForbiddenResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { CommentsService } from './comments.service';
import { CommentIdParamDto, UpdateCommentDto } from './dto/comment.dto';

@ApiTags('Blog')
@ApiCookieAuth('accessToken')
@ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id or body.' })
@ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
@ApiForbiddenResponse({ type: ApiErrorDto, description: 'Not your comment, or role not USER.' })
@ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such comment.' })
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Patch(':id')
  @ApiOperation({ summary: 'BLG-07: edit my comment', description: 'Non-empty, at most 500 characters.' })
  @ApiOkResponse({ description: 'The comment.' })
  update(@Param() params: CommentIdParamDto, @Body() dto: UpdateCommentDto, @Req() request: AuthenticatedRequest) {
    return this.comments.update(params.id, dto, request.user!);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'BLG-07: delete my comment' })
  @ApiNoContentResponse({ description: 'Deleted.' })
  remove(@Param() params: CommentIdParamDto, @Req() request: AuthenticatedRequest) {
    return this.comments.remove(params.id, request.user!);
  }
}
