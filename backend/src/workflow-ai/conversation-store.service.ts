import { Injectable } from '@nestjs/common';
import { type ModelMessage } from 'ai';
import { WorkflowDefinition } from '../web3/workflow-types';

export interface Conversation {
  id: string;
  walletAddress: string;
  messages: ModelMessage[];
  generatedWorkflow?: WorkflowDefinition;
  status: 'active' | 'confirmed';
  createdAt: Date;
}

@Injectable()
export class ConversationStoreService {
  private conversations = new Map<string, Conversation>();
  private readonly TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  create(walletAddress: string): Conversation {
    const id = crypto.randomUUID();
    const conversation: Conversation = {
      id,
      walletAddress,
      messages: [],
      status: 'active',
      createdAt: new Date(),
    };
    this.conversations.set(id, conversation);
    this.cleanup();
    return conversation;
  }

  get(id: string): Conversation | undefined {
    const conv = this.conversations.get(id);
    if (conv && Date.now() - conv.createdAt.getTime() > this.TTL_MS) {
      this.conversations.delete(id);
      return undefined;
    }
    return conv;
  }

  addMessage(id: string, message: ModelMessage): void {
    const conv = this.get(id);
    if (!conv) throw new Error(`Conversation ${id} not found`);
    conv.messages.push(message);
  }

  setGeneratedWorkflow(id: string, workflow: WorkflowDefinition): void {
    const conv = this.get(id);
    if (!conv) throw new Error(`Conversation ${id} not found`);
    conv.generatedWorkflow = workflow;
  }

  setStatus(id: string, status: 'active' | 'confirmed'): void {
    const conv = this.get(id);
    if (!conv) throw new Error(`Conversation ${id} not found`);
    conv.status = status;
  }

  listByWallet(walletAddress: string): Conversation[] {
    this.cleanup();
    return Array.from(this.conversations.values()).filter((c) => c.walletAddress === walletAddress);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, conv] of this.conversations.entries()) {
      if (now - conv.createdAt.getTime() > this.TTL_MS) {
        this.conversations.delete(id);
      }
    }
  }
}
