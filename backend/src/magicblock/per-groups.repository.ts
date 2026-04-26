import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';

export type PerMemberRole = 'creator' | 'operator' | 'viewer' | 'subscriber' | 'auditor';

export interface PerGroupMember {
  wallet: string;
  role: PerMemberRole;
  expiresAt?: string | null;
}

export interface PerGroupRow {
  id: string;
  deployment_id: string;
  group_id: string;
  creator_wallet: string;
  members: PerGroupMember[];
  created_at: string;
  updated_at: string;
}

export interface InsertPerGroupInput {
  deploymentId: string;
  groupId: string;
  creatorWallet: string;
  members: PerGroupMember[];
}

const COLUMNS = 'id, deployment_id, group_id, creator_wallet, members, created_at, updated_at';

@Injectable()
export class PerGroupsRepository {
  private readonly logger = new Logger(PerGroupsRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async createGroup(input: InsertPerGroupInput): Promise<PerGroupRow> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_per_groups')
      .insert({
        deployment_id: input.deploymentId,
        group_id: input.groupId,
        creator_wallet: input.creatorWallet,
        members: input.members,
      })
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to insert PER group', error);
      throw new InternalServerErrorException('Failed to insert PER group');
    }
    return data as unknown as PerGroupRow;
  }

  async getByDeployment(deploymentId: string): Promise<PerGroupRow | null> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_per_groups')
      .select(COLUMNS)
      .eq('deployment_id', deploymentId)
      .maybeSingle();
    if (error) {
      this.logger.error('Failed to fetch PER group', error);
      throw new InternalServerErrorException('Failed to fetch PER group');
    }
    return (data as unknown as PerGroupRow) ?? null;
  }

  async getByDeploymentOrThrow(deploymentId: string): Promise<PerGroupRow> {
    const row = await this.getByDeployment(deploymentId);
    if (!row) {
      throw new NotFoundException('PER group not found for deployment');
    }
    return row;
  }

  async replaceMembers(
    deploymentId: string,
    requesterWallet: string,
    members: PerGroupMember[],
  ): Promise<PerGroupRow> {
    const existing = await this.getByDeploymentOrThrow(deploymentId);
    if (existing.creator_wallet !== requesterWallet) {
      throw new ForbiddenException('Only the deployment creator may modify PER membership');
    }
    const { data, error } = await this.supabaseService.client
      .from('strategy_per_groups')
      .update({ members, updated_at: new Date().toISOString() })
      .eq('deployment_id', deploymentId)
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to update PER members', error);
      throw new InternalServerErrorException('Failed to update PER members');
    }
    return data as unknown as PerGroupRow;
  }

  async findMembership(deploymentId: string, wallet: string): Promise<PerGroupMember | null> {
    const row = await this.getByDeployment(deploymentId);
    if (!row) return null;
    const member = row.members.find((m) => m.wallet === wallet);
    if (!member) return null;
    if (member.expiresAt) {
      const exp = new Date(member.expiresAt).getTime();
      if (Number.isFinite(exp) && exp <= Date.now()) {
        return null;
      }
    }
    return member;
  }
}
