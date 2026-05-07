import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import * as idlJsonModule from './anchor/strategy_runtime.json';
import { AnchorClientService } from './anchor-client.service';
import {
  deriveDeploymentPda,
  derivePublicSnapshotPda,
  deriveStrategyStatePda,
  deriveVaultAuthorityPda,
} from './anchor/pda';

const idlJson = (idlJsonModule as any).default ?? idlJsonModule;

@ApiTags('Strategy Runtime Program')
@Controller('program/strategy-runtime')
export class OnchainProgramController {
  constructor(private readonly anchorClientService: AnchorClientService) {}

  @Get('metadata')
  @ApiOperation({ summary: 'Get strategy_runtime program metadata and instruction names' })
  metadata() {
    const programId = this.tryGetProgramId();
    return {
      success: true,
      data: {
        programId,
        name: idlJson.name ?? idlJson.metadata?.name ?? 'strategy_runtime',
        address: programId,
        instructionCount: idlJson.instructions?.length ?? 0,
        instructions: (idlJson.instructions ?? []).map((ix: any) => ix.name),
      },
    };
  }

  @Get('idl')
  @ApiOperation({ summary: 'Get the bundled strategy_runtime Anchor IDL' })
  idl() {
    return { success: true, data: idlJson };
  }

  @Get('instructions')
  @ApiOperation({ summary: 'Get a typed instruction manifest from the bundled IDL' })
  instructions() {
    const data = (idlJson.instructions ?? []).map((ix: any) => ({
      name: ix.name,
      discriminator: ix.discriminator,
      accounts: (ix.accounts ?? []).map((account: any) => ({
        name: account.name,
        writable: account.writable ?? false,
        signer: account.signer ?? false,
      })),
      args: (ix.args ?? []).map((arg: any) => ({ name: arg.name, type: arg.type })),
    }));
    return { success: true, count: data.length, data };
  }

  @Get('pdas/deployments/:deploymentId')
  @ApiOperation({ summary: 'Derive deployment, vault authority, state, and snapshot PDAs' })
  deploymentPdas(@Param('deploymentId') deploymentId: string) {
    const programId = this.anchorClientService.getProgramId();
    const [deploymentPda, deploymentBump] = deriveDeploymentPda(programId, deploymentId);
    const [vaultAuthorityPda, vaultAuthorityBump] = deriveVaultAuthorityPda(
      programId,
      deploymentPda,
    );
    const [strategyStatePda, strategyStateBump] = deriveStrategyStatePda(programId, deploymentPda);
    const [publicSnapshotPda, publicSnapshotBump] = derivePublicSnapshotPda(
      programId,
      deploymentPda,
    );

    return {
      success: true,
      data: {
        programId: programId.toBase58(),
        deploymentId,
        deploymentPda: deploymentPda.toBase58(),
        deploymentBump,
        vaultAuthorityPda: vaultAuthorityPda.toBase58(),
        vaultAuthorityBump,
        strategyStatePda: strategyStatePda.toBase58(),
        strategyStateBump,
        publicSnapshotPda: publicSnapshotPda.toBase58(),
        publicSnapshotBump,
      },
    };
  }

  private tryGetProgramId(): string | null {
    try {
      return this.anchorClientService.getProgramId().toBase58();
    } catch {
      return null;
    }
  }
}
