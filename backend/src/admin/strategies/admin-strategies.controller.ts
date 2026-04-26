import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminStrategiesService } from './admin-strategies.service';

@ApiTags('Admin Strategies')
@ApiBearerAuth()
@Controller('admin/strategies')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
export class AdminStrategiesController {
  constructor(private readonly strategiesService: AdminStrategiesService) {}

  @Get()
  @ApiOperation({ summary: 'List strategies (admin scope; bypasses creator filter)' })
  @ApiQuery({ name: 'lifecycle', required: false, enum: ['draft', 'published', 'archived'] })
  @ApiQuery({ name: 'visibility', required: false, enum: ['public', 'private'] })
  @ApiQuery({ name: 'creator', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async list(
    @Query('lifecycle') lifecycle?: 'draft' | 'published' | 'archived',
    @Query('visibility') visibility?: 'public' | 'private',
    @Query('creator') creator?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.strategiesService.listStrategies({
      lifecycle,
      visibility,
      creator,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, count: data.length, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail view including version history' })
  async detail(@Param('id') id: string) {
    const data = await this.strategiesService.getStrategyDetail(id);
    return { success: true, data };
  }
}
