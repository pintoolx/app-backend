import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminSystemService } from './admin-system.service';

@ApiTags('Admin System')
@ApiBearerAuth()
@Controller('admin/system')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
export class AdminSystemController {
  constructor(private readonly systemService: AdminSystemService) {}

  @Get('adapter-matrix')
  @ApiOperation({ summary: 'Snapshot of which port adapters are real vs noop right now' })
  matrix() {
    return { success: true, data: this.systemService.getAdapterMatrix() };
  }

  @Get('health')
  @ApiOperation({
    summary:
      'Run the full /health/ready probe and return the structured report (DB + RPC + adapters)',
  })
  async health() {
    const data = await this.systemService.getReadiness();
    return { success: true, data };
  }

  @Get('keeper')
  @ApiOperation({ summary: 'Keeper keypair status incl. on-chain SOL balance and warning level' })
  async keeper() {
    const data = await this.systemService.getKeeperStatus();
    return { success: true, data };
  }
}
