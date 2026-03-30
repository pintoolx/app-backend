import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { SupabaseJwtVerifierService } from '../../auth/supabase-jwt-verifier.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly supabaseJwtVerifierService: SupabaseJwtVerifierService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);
    request.user = await this.supabaseJwtVerifierService.verify(token);
    return true;
  }
}
