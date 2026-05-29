import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminTreasuryService } from './admin-treasury.service';

@ApiTags('Admin Treasury')
@ApiBearerAuth()
@Controller('admin/treasury')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
export class AdminTreasuryController {
  constructor(private readonly treasuryService: AdminTreasuryService) {}

  @Get('aum')
  @ApiOperation({
    summary:
      'Live follower-vault AUM/TVL for a treasury mint: per-vault on-chain SPL balances + platform total. Reads go through the onchain adapter (zero balances in noop/unconfigured envs).',
  })
  @ApiQuery({ name: 'mint', required: true, description: 'Treasury SPL mint to denominate AUM in' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max vaults to read (default 100, max 500)' })
  @ApiQuery({ name: 'includeClosed', required: false, type: Boolean })
  async aum(
    @Query('mint') mint?: string,
    @Query('limit') limit?: string,
    @Query('includeClosed') includeClosed?: string,
  ) {
    const data = await this.treasuryService.getAum({
      mint,
      limit: limit ? parseInt(limit, 10) : undefined,
      includeClosed: includeClosed === 'true' || includeClosed === '1',
    });
    return { success: true, data };
  }
}
