import { Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';

@Injectable()
export class WorkflowsService {
  constructor(
    @Inject(forwardRef(() => SupabaseService))
    private supabaseService: SupabaseService,
  ) {}

  async getWorkflows(walletAddress: string) {
    const { data, error } = await this.supabaseService.client
      .from('workflows')
      .select('*')
      .eq('owner_wallet_address', walletAddress)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Failed to fetch workflows:', error);
      throw new Error('Failed to fetch workflows');
    }

    return data;
  }

  async createWorkflow(walletAddress: string, createDto: any) {
    const { data, error } = await this.supabaseService.client
      .from('workflows')
      .insert({
        owner_wallet_address: walletAddress,
        name: createDto.name,
        description: createDto.description,
        definition: createDto.definition,
        is_active: createDto.isActive ?? true,
      })
      .select()
      .single();

    if (error) {
      console.error('❌ Failed to create workflow:', error);
      throw new Error('Failed to create workflow');
    }

    console.log(`✅ Workflow created: ${data.name}`);
    return data;
  }

  async getWorkflow(id: string, walletAddress: string) {
    const { data, error } = await this.supabaseService.client
      .from('workflows')
      .select('*')
      .eq('id', id)
      .eq('owner_wallet_address', walletAddress)
      .single();

    if (error || !data) {
      throw new NotFoundException('Workflow not found');
    }

    return data;
  }

  async updateWorkflow(id: string, walletAddress: string, updateDto: any) {
    const { data, error } = await this.supabaseService.client
      .from('workflows')
      .update({
        name: updateDto.name,
        description: updateDto.description,
        definition: updateDto.definition,
        is_active: updateDto.isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('owner_wallet_address', walletAddress)
      .select()
      .single();

    if (error || !data) {
      throw new NotFoundException('Workflow not found');
    }

    console.log(`✅ Workflow updated: ${data.name}`);
    return data;
  }

  async deleteWorkflow(id: string, walletAddress: string) {
    const { error } = await this.supabaseService.client
      .from('workflows')
      .delete()
      .eq('id', id)
      .eq('owner_wallet_address', walletAddress);

    if (error) {
      throw new NotFoundException('Workflow not found');
    }

    console.log(`✅ Workflow deleted: ${id}`);
  }

  async executeWorkflow(id: string, walletAddress: string, executeDto: any) {
    const workflow = await this.getWorkflow(id, walletAddress);

    console.log(`⚙️ Executing workflow: ${workflow.name}`);

    // Create execution record
    const { data: execution, error } = await this.supabaseService.client
      .from('workflow_executions')
      .insert({
        workflow_id: id,
        owner_wallet_address: walletAddress,
        account_id: executeDto.accountId,
        status: 'running',
        trigger_type: 'manual',
      })
      .select()
      .single();

    if (error) {
      console.error('❌ Failed to create execution:', error);
      throw new Error('Failed to start workflow execution');
    }

    // TODO: Integrate with WorkflowExecutor
    // For now, just return the execution record
    console.log(`✅ Workflow execution started: ${execution.id}`);

    return execution;
  }
}
