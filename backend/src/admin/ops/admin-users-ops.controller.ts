import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRolesGuard } from '../auth/admin-roles.guard';
import { AdminRoles } from '../auth/admin-roles.decorator';
import { CurrentAdmin } from '../auth/current-admin.decorator';
import { AdminAudit } from '../audit/audit.interceptor';
import { AdminOpsService } from './admin-ops.service';
import { BanWalletDto } from './dto/ban-wallet.dto';
import { AdminConfirmDto } from './dto/confirm.dto';
import type { AdminAccessClaims } from '../auth/admin-token.service';

@ApiTags('Admin Ops · Users')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(AdminJwtGuard, AdminRolesGuard)
export class AdminUsersOpsController {
  constructor(private readonly opsService: AdminOpsService) {}

  @Get('banned')
  @AdminRoles('operator', 'superadmin')
  @ApiOperation({ summary: 'List currently banned wallets (operator+).' })
  async listBanned() {
    const data = await this.opsService.listBannedWallets();
    return { success: true, count: data.length, data };
  }

  @Post(':wallet/ban')
  @HttpCode(200)
  @AdminRoles('superadmin')
  @AdminAudit({ action: 'wallet.ban', targetType: 'wallet', targetIdParam: 'wallet' })
  @ApiOperation({ summary: 'Ban a wallet from the user-facing API (superadmin only).' })
  async ban(
    @Param('wallet') wallet: string,
    @Body() dto: BanWalletDto,
    @CurrentAdmin() claims: AdminAccessClaims,
  ) {
    if (dto.confirmTargetId !== wallet) {
      throw new BadRequestException('confirmTargetId must equal the path :wallet');
    }
    const data = await this.opsService.banWallet({
      wallet,
      actor: { id: claims.sub, email: claims.email, role: claims.role },
      reason: dto.reason ?? null,
      expiresAt: dto.expiresAt ?? null,
    });
    return { success: true, data };
  }

  @Post(':wallet/unban')
  @HttpCode(200)
  @AdminRoles('superadmin')
  @AdminAudit({ action: 'wallet.unban', targetType: 'wallet', targetIdParam: 'wallet' })
  @ApiOperation({ summary: 'Remove a wallet from the ban list (superadmin only).' })
  async unban(@Param('wallet') wallet: string, @Body() dto: AdminConfirmDto) {
    if (dto.confirmTargetId !== wallet) {
      throw new BadRequestException('confirmTargetId must equal the path :wallet');
    }
    const data = await this.opsService.unbanWallet(wallet);
    return { success: true, data };
  }
}
