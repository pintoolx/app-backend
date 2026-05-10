import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateStrategyDto } from './dto/create-strategy.dto';
import { UpdateStrategyDto } from './dto/update-strategy.dto';
import { StrategiesService } from './strategies.service';

@ApiTags('Strategies')
@Controller('strategies')
export class StrategiesController {
  constructor(private readonly strategiesService: StrategiesService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List published strategies available through active creator subscriptions',
  })
  @ApiResponse({ status: 200, description: 'Subscribed strategy list returned successfully' })
  async listPublicStrategies(@CurrentUser('walletAddress') walletAddress: string) {
    const data = await this.strategiesService.listSubscribedPublishedStrategies(walletAddress);
    return { success: true, count: data.length, data };
  }

  @Get('marketplace')
  @ApiOperation({
    summary:
      'Public marketplace listing — every published strategy with creator denorm fields (verified, display name, subscriber count, monthly price). No JWT required so the marketplace is browseable pre-login.',
  })
  @ApiResponse({ status: 200, description: 'Marketplace strategy list returned successfully' })
  async listMarketplace(
    @Query('sort') sort?: 'recent' | 'trending',
    @Query('limit') limit?: string,
  ) {
    const data = await this.strategiesService.listMarketplaceStrategies({
      sort: sort === 'trending' || sort === 'recent' ? sort : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, count: data.length, data };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List strategies owned by the authenticated wallet' })
  @ApiResponse({ status: 200, description: 'Owner strategy list returned successfully' })
  async listMyStrategies(@CurrentUser('walletAddress') walletAddress: string) {
    const data = await this.strategiesService.listStrategiesForOwner(walletAddress);
    return { success: true, count: data.length, data };
  }

  @Get('me/purchases')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'List one-time strategy buyouts owned by the authenticated wallet. Used by the portfolio dashboard to mark strategies as unlocked-via-purchase.',
  })
  async listMyPurchases(@CurrentUser('walletAddress') walletAddress: string) {
    const data = await this.strategiesService.listPurchasesForBuyer(walletAddress);
    return { success: true, count: data.length, data };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get a strategy view if owned by the caller or unlocked by subscription',
  })
  @ApiResponse({ status: 200, description: 'Public strategy detail returned successfully' })
  async getPublicStrategy(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.strategiesService.getStrategyForViewer(id, walletAddress);
    return { success: true, data };
  }

  @Get(':id/pnl')
  @ApiOperation({
    summary:
      'Strategy-level pnl_summary_bps timeseries aggregated across deployments. Default window 30 days, clamped 1..90. No JWT required — same surface the marketplace exposes.',
  })
  async pnl(@Param('id') id: string, @Query('days') days?: string) {
    const data = await this.strategiesService.getStrategyPnl(id, {
      days: days ? parseInt(days, 10) : undefined,
    });
    return { success: true, data };
  }

  @Get(':id/private')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the private strategy view for the owner' })
  @ApiResponse({ status: 200, description: 'Private strategy detail returned successfully' })
  async getPrivateStrategy(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.strategiesService.getStrategyForOwner(id, walletAddress);
    return { success: true, data };
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a draft strategy from the current workflow graph format' })
  @ApiResponse({ status: 201, description: 'Strategy created successfully' })
  async createStrategy(
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: CreateStrategyDto,
  ) {
    const data = await this.strategiesService.createStrategy(walletAddress, dto);
    return { success: true, data };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a strategy owned by the authenticated wallet' })
  @ApiResponse({ status: 200, description: 'Strategy updated successfully' })
  async updateStrategy(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: UpdateStrategyDto,
  ) {
    const data = await this.strategiesService.updateStrategy(id, walletAddress, dto);
    return { success: true, data };
  }

  @Post(':id/compile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Compile a strategy into public and private IR' })
  @ApiResponse({ status: 200, description: 'Strategy compiled successfully' })
  async compileStrategy(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.strategiesService.compileStrategy(id, walletAddress);
    return { success: true, data };
  }

  @Post(':id/publish')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publish a strategy to the public discovery surface' })
  @ApiResponse({ status: 200, description: 'Strategy published successfully' })
  async publishStrategy(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.strategiesService.publishStrategy(id, walletAddress);
    return { success: true, data };
  }

  // ---------------- Strategy buyout (per-strategy one-time purchase) -------

  @Patch(':id/purchase-price')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Owner sets / unsets the one-time buyout price for the strategy (lamports, native SOL). Pass priceAmount as null to take it off-sale.',
  })
  async setPurchasePrice(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: { priceAmount: string | null },
  ) {
    const data = await this.strategiesService.setPurchasePrice(id, walletAddress, dto);
    return { success: true, data };
  }

  @Get(':id/purchase-quote')
  @ApiOperation({
    summary:
      'Public buyout quote — price (lamports, native SOL) and creator payout wallet. No JWT required; if no Authorization header is present `alreadyOwned` is always false.',
  })
  async getPurchaseQuote(@Param('id') id: string, @Query('wallet') wallet?: string) {
    const data = await this.strategiesService.getPurchaseQuote(id, wallet ?? null);
    return { success: true, data };
  }

  @Post(':id/purchase-intent')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Build an unsigned SPL transfer transaction the buyer signs to purchase the strategy. Submits go via the buyer wallet, then `purchase-confirm` records the purchase.',
  })
  async buildPurchaseIntent(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
  ) {
    const data = await this.strategiesService.buildPurchaseIntent(id, walletAddress);
    return { success: true, data };
  }

  @Post(':id/purchase-confirm')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Confirm a successful buyout: verifies the on-chain SPL transfer matches the listed price/mint/payout and records the purchase.',
  })
  async confirmPurchase(
    @Param('id') id: string,
    @CurrentUser('walletAddress') walletAddress: string,
    @Body() dto: { txSignature: string },
  ) {
    const data = await this.strategiesService.confirmPurchase(id, walletAddress, dto.txSignature);
    return { success: true, data };
  }
}
