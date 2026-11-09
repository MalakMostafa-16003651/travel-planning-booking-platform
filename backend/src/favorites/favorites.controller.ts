import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiInternalServerErrorResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthenticatedRequest, AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { CreateFavoriteDto } from './dto/create-favorite.dto';
import { FavoriteIdParamsDto } from './dto/favorite-id-params.dto';
import { FavoriteDto, FavoritePageDto } from './dto/favorite-response.dto';
import { ListFavoritesQueryDto } from './dto/list-favorites-query.dto';
import { FavoritesService } from './favorites.service';

@ApiTags('Favorites')
@ApiCookieAuth('accessToken')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto, description: 'Only registered users; cross-origin browser writes are rejected.' })
@ApiBadRequestResponse({ type: ApiErrorDto })
@ApiInternalServerErrorResponse({ type: ApiErrorDto })
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'BON-02: save a hotel or public itinerary', description: 'Supply exactly one of hotelId/itineraryId. Ownership comes from the session. No target content is stored.' })
  @ApiCreatedResponse({ type: FavoriteDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Target is missing or not publicly available.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Already saved, including concurrent requests.' })
  create(@Req() request: AuthenticatedRequest, @Body() input: CreateFavoriteDto): Promise<FavoriteDto> {
    return this.favorites.create(request.user!.userId, input);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'BON-02: list your favorites', description: 'Newest first, 10 per page (GEN-05). Unavailable targets retain only your saved reference, with available=false and no target content. Totals count saved references.' })
  @ApiOkResponse({ type: FavoritePageDto })
  list(@Req() request: AuthenticatedRequest, @Query() query: ListFavoritesQueryDto): Promise<FavoritePageDto> {
    return this.favorites.listMine(request.user!.userId, query.page);
  }

  @Delete(':favoriteId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'BON-02: remove your favorite', description: 'Owner-only, including when the target is no longer available. Never deletes or changes the saved hotel/itinerary.' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such saved favorite in your account.' })
  remove(@Req() request: AuthenticatedRequest, @Param() params: FavoriteIdParamsDto): Promise<void> {
    return this.favorites.remove(request.user!.userId, params.favoriteId);
  }
}
