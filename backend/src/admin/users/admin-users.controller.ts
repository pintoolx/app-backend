import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminUsersService } from './admin-users.service';

@ApiTags('Admin Users')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
export class AdminUsersController {
  constructor(private readonly usersService: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'List end-users (wallets) with basic counts; filter by partial wallet' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async list(@Query('search') search?: string, @Query('limit') limit?: string) {
    const data = await this.usersService.listUsers({
      search,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, count: data.length, data };
  }

  @Get(':wallet')
  @ApiOperation({ summary: 'Detail view for a single wallet (accounts + counts)' })
  async detail(@Param('wallet') wallet: string) {
    const data = await this.usersService.getUserDetail(wallet);
    return { success: true, data };
  }
}
