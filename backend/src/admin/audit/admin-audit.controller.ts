import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AuditLogService } from './audit-log.service';
import type { AuditStatus } from './audit-logs.repository';

@ApiTags('Admin Audit')
@ApiBearerAuth()
@Controller('admin/audit')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
export class AdminAuditController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @ApiOperation({ summary: 'Search the admin audit log (newest first, max 500)' })
  @ApiQuery({ name: 'admin', required: false, description: 'admin_user_id (uuid)' })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'targetType', required: false })
  @ApiQuery({ name: 'targetId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['success', 'failure'] })
  @ApiQuery({ name: 'from', required: false, description: 'ISO timestamp inclusive lower bound' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO timestamp inclusive upper bound' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async list(
    @Query('admin') admin?: string,
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('status') status?: AuditStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.auditLogService.list({
      adminUserId: admin,
      action,
      targetType,
      targetId,
      status,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, count: data.length, data };
  }
}
