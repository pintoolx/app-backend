import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const AgentWallet = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.agentWalletAddress;
  },
);
