import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminOverviewService } from './admin-overview.service';

@ApiTags('Admin Overview')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
export class AdminOverviewController {
  constructor(private readonly overviewService: AdminOverviewService) {}

  @Get('overview')
  @ApiOperation({
    summary:
      'Aggregate KPI snapshot for the admin dashboard landing page (counts, adapter matrix, recent actions)',
  })
  async overview() {
    const data = await this.overviewService.getOverview();
    return { success: true, data };
  }
}
