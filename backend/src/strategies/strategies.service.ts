import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  StrategyCompilerService,
  type CompiledStrategyIR,
  type PrivateStrategyDefinition,
  type PublicStrategyDefinition,
  type StrategyPublicMetadata,
} from '../strategy-compiler/strategy-compiler.service';
import { type WorkflowDefinition } from '../web3/workflow-types';
import { type CreateStrategyDto } from './dto/create-strategy.dto';
import { type UpdateStrategyDto } from './dto/update-strategy.dto';
import {
  StrategiesRepository,
  type StrategyLifecycleState,
  type StrategyRow,
  type StrategyVisibilityMode,
} from './strategies.repository';
import {
  StrategyVersionsRepository,
  type StrategyVersionRow,
} from './strategy-versions.repository';

export interface StrategyPublicView {
  id: string;
  ownerWalletAddress: string;
  name: string;
  description: string | null;
  visibilityMode: StrategyVisibilityMode;
  lifecycleState: StrategyLifecycleState;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  publicMetadata: StrategyPublicMetadata;
  publicDefinition: PublicStrategyDefinition;
}

export interface StrategyPrivateView extends StrategyPublicView {
  sourceWorkflowId: string | null;
  privateDefinition: PrivateStrategyDefinition;
  compiledIr: CompiledStrategyIR;
}

@Injectable()
export class StrategiesService {
  private readonly logger = new Logger(StrategiesService.name);

  constructor(
    private readonly strategyCompilerService: StrategyCompilerService,
    private readonly strategiesRepository: StrategiesRepository,
    private readonly strategyVersionsRepository: StrategyVersionsRepository,
  ) {}

  async createStrategy(
    walletAddress: string,
    dto: CreateStrategyDto,
  ): Promise<StrategyPrivateView> {
    const definition = await this.resolveDefinitionFromInput(walletAddress, dto);
    this.validateStrategyDefinition(definition);

    if (dto.telegramChatId) {
      await this.strategiesRepository.upsertTelegramMapping(walletAddress, dto.telegramChatId);
    }

    const compiled = this.strategyCompilerService.compileStrategyIR(definition);
    const visibilityMode = dto.visibilityMode ?? 'private';

    const row = await this.strategiesRepository.insertStrategy({
      creatorWalletAddress: walletAddress,
      sourceWorkflowId: dto.sourceWorkflowId ?? null,
      name: dto.name,
      description: dto.description ?? null,
      visibilityMode,
      publicMetadata: compiled.publicMetadata,
      compiledIr: compiled,
    });

    return this.toPrivateView(row, compiled);
  }

  async listPublicStrategies(): Promise<StrategyPublicView[]> {
    const rows = await this.strategiesRepository.listPublicStrategies();
    return rows.map((row) => this.toPublicView(row));
  }

  async listStrategiesForOwner(walletAddress: string): Promise<StrategyPrivateView[]> {
    const rows = await this.strategiesRepository.listStrategiesForCreator(walletAddress);
    return rows.map((row) => {
      const compiled = this.requireCompiledIr(row);
      return this.toPrivateView(row, compiled);
    });
  }

  async getPublicStrategy(id: string): Promise<StrategyPublicView> {
    const row = await this.strategiesRepository.getStrategyById(id);
    if (row.visibility_mode !== 'public' || row.lifecycle_state !== 'published') {
      throw new BadRequestException('Strategy is not published');
    }
    return this.toPublicView(row);
  }

  async getStrategyForOwner(id: string, walletAddress: string): Promise<StrategyPrivateView> {
    const row = await this.strategiesRepository.getStrategyForCreator(id, walletAddress);
    const compiled = this.requireCompiledIr(row);
    return this.toPrivateView(row, compiled);
  }

  async updateStrategy(
    id: string,
    walletAddress: string,
    dto: UpdateStrategyDto,
  ): Promise<StrategyPrivateView> {
    // Ownership check; throws NotFound if the wallet doesn't own this strategy.
    await this.strategiesRepository.getStrategyForCreator(id, walletAddress);

    let recompiled: CompiledStrategyIR | undefined;

    if (dto.definition !== undefined) {
      const definition = dto.definition as WorkflowDefinition;
      this.validateStrategyDefinition(definition);
      recompiled = this.strategyCompilerService.compileStrategyIR(definition);
    }

    if (dto.telegramChatId) {
      await this.strategiesRepository.upsertTelegramMapping(walletAddress, dto.telegramChatId);
    }

    const updated = await this.strategiesRepository.updateStrategy(id, walletAddress, {
      name: dto.name,
      description: dto.description ?? undefined,
      visibilityMode: dto.visibilityMode,
      publicMetadata: recompiled?.publicMetadata,
      compiledIr: recompiled,
    });

    return this.toPrivateView(updated, recompiled ?? this.requireCompiledIr(updated));
  }

  async compileStrategy(id: string, walletAddress: string): Promise<CompiledStrategyIR> {
    const row = await this.strategiesRepository.getStrategyForCreator(id, walletAddress);
    return this.requireCompiledIr(row);
  }

  async publishStrategy(id: string, walletAddress: string): Promise<StrategyPrivateView> {
    const existing = await this.strategiesRepository.getStrategyForCreator(id, walletAddress);
    const compiled = this.requireCompiledIr(existing);
    const nextVersion = existing.current_version + 1;

    const versionRow = await this.strategyVersionsRepository.insertVersion({
      strategyId: id,
      version: nextVersion,
      publicMetadataHash: compiled.publicMetadata.publicMetadataHash,
      privateDefinitionCommitment: compiled.privateDefinition.privateDefinitionCommitment,
      compiledIr: compiled,
    });

    this.logger.log(
      `Strategy ${id} published as version ${versionRow.version} (id=${versionRow.id})`,
    );

    const updated = await this.strategiesRepository.updateStrategy(id, walletAddress, {
      visibilityMode: 'public',
      lifecycleState: 'published',
      publicMetadata: compiled.publicMetadata,
      compiledIr: compiled,
      currentVersion: nextVersion,
    });

    return this.toPrivateView(updated, compiled);
  }

  async getLatestPublishedVersion(strategyId: string): Promise<StrategyVersionRow> {
    return this.strategyVersionsRepository.getLatestPublished(strategyId);
  }

  private async resolveDefinitionFromInput(
    walletAddress: string,
    dto: CreateStrategyDto,
  ): Promise<WorkflowDefinition> {
    if (dto.definition) {
      return dto.definition as WorkflowDefinition;
    }
    if (dto.sourceWorkflowId) {
      const workflow = await this.strategiesRepository.getWorkflowForCreator(
        dto.sourceWorkflowId,
        walletAddress,
      );
      return workflow.definition;
    }
    throw new BadRequestException(
      'Strategy creation requires either definition or sourceWorkflowId',
    );
  }

  private validateStrategyDefinition(definition: any): asserts definition is WorkflowDefinition {
    try {
      this.strategyCompilerService.validateGraph(definition);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Invalid strategy definition',
      );
    }
  }

  private toPublicView(row: StrategyRow): StrategyPublicView {
    const compiled = this.requireCompiledIr(row);
    return {
      id: row.id,
      ownerWalletAddress: row.creator_wallet_address,
      name: row.name,
      description: row.description,
      visibilityMode: row.visibility_mode,
      lifecycleState: row.lifecycle_state,
      currentVersion: row.current_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publicMetadata: compiled.publicMetadata,
      publicDefinition: compiled.publicDefinition,
    };
  }

  private toPrivateView(row: StrategyRow, compiled: CompiledStrategyIR): StrategyPrivateView {
    return {
      ...this.toPublicView(row),
      sourceWorkflowId: row.source_workflow_id,
      privateDefinition: compiled.privateDefinition,
      compiledIr: compiled,
    };
  }

  private requireCompiledIr(row: StrategyRow): CompiledStrategyIR {
    if (row.compiled_ir) {
      return row.compiled_ir as CompiledStrategyIR;
    }
    this.logger.warn(`Strategy ${row.id} missing compiled_ir; recompiling on the fly`);
    throw new BadRequestException(
      'Strategy compiled IR is missing; recompile via POST /strategies/:id/compile',
    );
  }
}
