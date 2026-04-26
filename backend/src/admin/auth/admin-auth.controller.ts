import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AdminAuthService } from './admin-auth.service';
import { AdminJwtGuard, type AdminAuthRequest } from './admin-jwt.guard';
import { CurrentAdmin } from './current-admin.decorator';
import { AdminLoginDto } from './dto/login.dto';
import { AdminTotpVerifyDto } from './dto/totp-verify.dto';
import { AdminRefreshDto } from './dto/refresh.dto';
import type { AdminAccessClaims } from './admin-token.service';

@ApiTags('Admin Auth')
@Controller('admin/auth')
export class AdminAuthController {
  private readonly allowlist: Set<string>;

  constructor(
    private readonly adminAuthService: AdminAuthService,
    private readonly configService: ConfigService,
  ) {
    const raw = this.configService.get<string>('admin.ipAllowlist') ?? '';
    this.allowlist = new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Step 1 of admin login. Verifies email + password and returns a 2FA-pending token.',
  })
  @ApiResponse({ status: 200, description: '2FA required' })
  @ApiResponse({ status: 401, description: 'Invalid credentials or account locked' })
  async login(@Body() dto: AdminLoginDto) {
    const data = await this.adminAuthService.login(dto.email, dto.password);
    return { success: true, data };
  }

  @Post('2fa')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Step 2 of admin login. Trades a 2FA-pending token + TOTP code for an access session.',
  })
  async verify2fa(@Body() dto: AdminTotpVerifyDto, @Req() req: Request) {
    const data = await this.adminAuthService.verify2fa(dto.tempToken, dto.totpCode, {
      ipAddress: AdminAuthController.extractIp(req),
      userAgent: this.headerString(req, 'user-agent'),
      ipAllowed: this.isIpAllowed(req),
    });
    return { success: true, data };
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token and return a fresh access session' })
  async refresh(@Body() dto: AdminRefreshDto, @Req() req: Request) {
    const data = await this.adminAuthService.refresh(dto.refreshToken, {
      ipAddress: AdminAuthController.extractIp(req),
      userAgent: this.headerString(req, 'user-agent'),
      ipAllowed: this.isIpAllowed(req),
    });
    return { success: true, data };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the current refresh token' })
  async logout(@Body() dto: AdminRefreshDto) {
    await this.adminAuthService.logout(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the verified claims for the active admin token' })
  me(@CurrentAdmin() claims: AdminAccessClaims) {
    return {
      success: true,
      data: {
        id: claims.sub,
        email: claims.email,
        role: claims.role,
        expiresAt: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
      },
    };
  }

  // ------------------------------------------------------------------ utils

  private headerString(req: Request, name: string): string | null {
    const value = req.headers[name];
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && value.length > 0) return value[0];
    return null;
  }

  private isIpAllowed(req: Request): boolean {
    if (this.allowlist.size === 0) return true;
    const ip = AdminAuthController.extractIp(req);
    return ip !== null && this.allowlist.has(ip);
  }

  static extractIp(req: Request | AdminAuthRequest): string | null {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.ip ?? null;
  }
}
