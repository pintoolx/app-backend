import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
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
  @ApiOperation({ summary: 'List public strategies' })
  @ApiResponse({ status: 200, description: 'Public strategy list returned successfully' })
  async listPublicStrategies() {
    const data = await this.strategiesService.listPublicStrategies();
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

  @Get(':id')
  @ApiOperation({ summary: 'Get a public strategy view' })
  @ApiResponse({ status: 200, description: 'Public strategy detail returned successfully' })
  async getPublicStrategy(@Param('id') id: string) {
    const data = await this.strategiesService.getPublicStrategy(id);
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
}
