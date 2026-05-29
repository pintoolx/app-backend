import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreatorsService } from './creators.service';

/**
 * Public creator profile read surface. Aggregates per-creator denorm fields
 * (subscriber count, verified flag, display name) plus a snapshot of the
 * creator's published strategies. No JWT required — the response is the
 * same data the marketplace badge exposes, so it's safe to browse pre-login.
 */
@ApiTags('Creators')
@Controller('creators')
export class CreatorsController {
  constructor(private readonly creatorsService: CreatorsService) {}

  @Get(':wallet')
  @ApiOperation({
    summary:
      'Public creator profile: display name, verified flag, active subscriber count, monthly plan price, and recent published strategies. Returns 200 even for unknown wallets — fields default to safe zeros.',
  })
  async getProfile(@Param('wallet') wallet: string) {
    const data = await this.creatorsService.getProfile(wallet);
    return { success: true, data };
  }
}
