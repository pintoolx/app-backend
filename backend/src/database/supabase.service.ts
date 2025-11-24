import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private supabaseClient: SupabaseClient;

  constructor(private configService: ConfigService) { }

  onModuleInit() {
    const supabaseUrl = this.configService.get<string>('supabase.url');
    const supabaseKey = this.configService.get<string>('supabase.serviceKey');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase URL and Service Key must be provided');
    }

    this.supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    console.log('✅ Supabase client initialized successfully');
  }

  get client(): SupabaseClient {
    return this.supabaseClient;
  }

  // Helper method to set RLS context for wallet address
  async setRLSContext(walletAddress: string) {
    await this.supabaseClient.rpc('set_config', {
      setting: 'app.current_wallet',  // Fixed: must match schema RLS policies
      value: walletAddress,
      is_local: true,
    });
  }
}
