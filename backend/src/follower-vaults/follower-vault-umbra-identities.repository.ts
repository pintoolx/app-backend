import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';

export type UmbraRegistrationStatus = 'pending' | 'confirmed' | 'failed';

export interface FollowerVaultUmbraIdentityRow {
  id: string;
  follower_vault_id: string;
  signer_pubkey: string;
  x25519_public_key: string | null;
  encrypted_user_account: string | null;
  derivation_salt: string;
  mvk_ref: string | null;
  registration_status: UmbraRegistrationStatus | null;
  register_queue_signature: string | null;
  register_callback_signature: string | null;
  created_at: string;
}

export interface InsertUmbraIdentityInput {
  followerVaultId: string;
  signerPubkey: string;
  derivationSalt: string;
  x25519PublicKey?: string | null;
  encryptedUserAccount?: string | null;
  mvkRef?: string | null;
  registrationStatus?: UmbraRegistrationStatus | null;
  registerQueueSignature?: string | null;
  registerCallbackSignature?: string | null;
}

export interface UpdateUmbraIdentityInput {
  x25519PublicKey?: string | null;
  encryptedUserAccount?: string | null;
  mvkRef?: string | null;
  registrationStatus?: UmbraRegistrationStatus | null;
  registerQueueSignature?: string | null;
  registerCallbackSignature?: string | null;
}

const COLUMNS = [
  'id',
  'follower_vault_id',
  'signer_pubkey',
  'x25519_public_key',
  'encrypted_user_account',
  'derivation_salt',
  'mvk_ref',
  'registration_status',
  'register_queue_signature',
  'register_callback_signature',
  'created_at',
].join(', ');

@Injectable()
export class FollowerVaultUmbraIdentitiesRepository {
  private readonly logger = new Logger(FollowerVaultUmbraIdentitiesRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async insert(input: InsertUmbraIdentityInput): Promise<FollowerVaultUmbraIdentityRow> {
    const { data, error } = await this.supabaseService.client
      .from('follower_vault_umbra_identities')
      .insert({
        follower_vault_id: input.followerVaultId,
        signer_pubkey: input.signerPubkey,
        derivation_salt: input.derivationSalt,
        x25519_public_key: input.x25519PublicKey ?? null,
        encrypted_user_account: input.encryptedUserAccount ?? null,
        mvk_ref: input.mvkRef ?? null,
        registration_status: input.registrationStatus ?? null,
        register_queue_signature: input.registerQueueSignature ?? null,
        register_callback_signature: input.registerCallbackSignature ?? null,
      })
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to insert follower-vault Umbra identity', error);
      throw new InternalServerErrorException('Failed to create follower-vault Umbra identity');
    }
    return data as unknown as FollowerVaultUmbraIdentityRow;
  }

  async getByFollowerVaultId(
    followerVaultId: string,
  ): Promise<FollowerVaultUmbraIdentityRow | null> {
    const { data, error } = await this.supabaseService.client
      .from('follower_vault_umbra_identities')
      .select(COLUMNS)
      .eq('follower_vault_id', followerVaultId)
      .maybeSingle();
    if (error) {
      this.logger.error('Failed to fetch follower-vault Umbra identity', error);
      throw new InternalServerErrorException('Failed to fetch Umbra identity');
    }
    return (data as unknown as FollowerVaultUmbraIdentityRow) ?? null;
  }

  async getById(id: string): Promise<FollowerVaultUmbraIdentityRow | null> {
    const { data, error } = await this.supabaseService.client
      .from('follower_vault_umbra_identities')
      .select(COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) {
      this.logger.error('Failed to fetch Umbra identity by id', error);
      throw new InternalServerErrorException('Failed to fetch Umbra identity');
    }
    return (data as unknown as FollowerVaultUmbraIdentityRow) ?? null;
  }

  async update(
    id: string,
    input: UpdateUmbraIdentityInput,
  ): Promise<FollowerVaultUmbraIdentityRow> {
    const updates: Record<string, unknown> = {};
    if (input.x25519PublicKey !== undefined) updates.x25519_public_key = input.x25519PublicKey;
    if (input.encryptedUserAccount !== undefined)
      updates.encrypted_user_account = input.encryptedUserAccount;
    if (input.mvkRef !== undefined) updates.mvk_ref = input.mvkRef;
    if (input.registrationStatus !== undefined)
      updates.registration_status = input.registrationStatus;
    if (input.registerQueueSignature !== undefined)
      updates.register_queue_signature = input.registerQueueSignature;
    if (input.registerCallbackSignature !== undefined)
      updates.register_callback_signature = input.registerCallbackSignature;

    const { data, error } = await this.supabaseService.client
      .from('follower_vault_umbra_identities')
      .update(updates)
      .eq('id', id)
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to update Umbra identity', error);
      throw new InternalServerErrorException('Failed to update Umbra identity');
    }
    return data as unknown as FollowerVaultUmbraIdentityRow;
  }
}
