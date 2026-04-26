import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AdminAuthRequest } from './admin-jwt.guard';
import type { AdminAccessClaims } from './admin-token.service';

/**
 * Extracts the verified admin claims off the request. When `field` is
 * provided (`@CurrentAdmin('email')`) the matching claim is returned;
 * otherwise the whole claims object.
 */
export const CurrentAdmin = createParamDecorator(
  (field: keyof AdminAccessClaims | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<AdminAuthRequest>();
    const claims = req.admin;
    if (!claims) return undefined;
    return field ? claims[field] : claims;
  },
);
