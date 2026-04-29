import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import {
  PerAuthGuard,
  assertSubscriptionScope,
  assertDeploymentScope,
} from './per-auth.guard';
import { PerAuthTokensRepository, type PerAuthTokenRow } from './per-auth-tokens.repository';

const buildContext = (headers: Record<string, string>): ExecutionContext => {
  const req: { headers: Record<string, string>; perToken?: PerAuthTokenRow } = { headers };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
};

const buildTokensRepo = (resolved: PerAuthTokenRow | Error): PerAuthTokensRepository =>
  ({
    getActiveOrThrow:
      resolved instanceof Error
        ? jest.fn().mockRejectedValue(resolved)
        : jest.fn().mockResolvedValue(resolved),
  }) as unknown as PerAuthTokensRepository;

const activeRow: PerAuthTokenRow = {
  token: 't',
  deployment_id: 'd1',
  wallet: 'w1',
  group_id: 'g1',
  scope_kind: 'deployment',
  subscription_id: null,
  status: 'active',
  scopes: [],
  issued_at: '2026-01-01T00:00:00.000Z',
  expires_at: '2030-01-01T00:00:00.000Z',
  revoked_at: null,
};

describe('PerAuthGuard', () => {
  it('throws when no token header is provided', async () => {
    const guard = new PerAuthGuard(buildTokensRepo(activeRow));
    await expect(guard.canActivate(buildContext({}))).rejects.toThrow(UnauthorizedException);
  });

  it('extracts and validates Bearer tokens', async () => {
    const guard = new PerAuthGuard(buildTokensRepo(activeRow));
    const ctx = buildContext({ authorization: 'Bearer mytoken' });
    const ok = await guard.canActivate(ctx);
    expect(ok).toBe(true);
  });

  it('extracts X-PER-Token header without Bearer prefix', async () => {
    const guard = new PerAuthGuard(buildTokensRepo(activeRow));
    const ctx = buildContext({ 'x-per-token': 'mytoken' });
    const ok = await guard.canActivate(ctx);
    expect(ok).toBe(true);
  });

  it('propagates UnauthorizedException from the repo', async () => {
    const guard = new PerAuthGuard(buildTokensRepo(new UnauthorizedException('expired')));
    await expect(guard.canActivate(buildContext({ authorization: 'Bearer t' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('assertSubscriptionScope', () => {
  const subToken: PerAuthTokenRow = {
    ...activeRow,
    scope_kind: 'subscription',
    subscription_id: 'sub-1',
  };

  it('accepts a subscription token bound to the same subscription id', () => {
    expect(() => assertSubscriptionScope(subToken, 'sub-1')).not.toThrow();
  });

  it('rejects a deployment-scope token', () => {
    expect(() => assertSubscriptionScope(activeRow, 'sub-1')).toThrow(UnauthorizedException);
  });

  it('rejects a subscription token bound to a sibling subscription', () => {
    expect(() => assertSubscriptionScope(subToken, 'sub-OTHER')).toThrow(UnauthorizedException);
  });

  it('rejects a missing token', () => {
    expect(() => assertSubscriptionScope(undefined, 'sub-1')).toThrow(UnauthorizedException);
  });
});

describe('assertDeploymentScope', () => {
  it('accepts a deployment token bound to the same deployment id', () => {
    expect(() => assertDeploymentScope(activeRow, 'd1')).not.toThrow();
  });

  it('rejects a subscription-scope token', () => {
    const subToken: PerAuthTokenRow = {
      ...activeRow,
      scope_kind: 'subscription',
      subscription_id: 'sub-1',
    };
    expect(() => assertDeploymentScope(subToken, 'd1')).toThrow(UnauthorizedException);
  });
});
