export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',

  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
    jwtSecret: process.env.JWT_SECRET,
    jwtIssuer: process.env.SUPABASE_JWT_ISSUER || `${process.env.SUPABASE_URL}/auth/v1`,
    jwtAudience: process.env.SUPABASE_JWT_AUDIENCE || 'authenticated',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    notifyEnabled: process.env.TELEGRAM_NOTIFY_ENABLED === 'true',
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL,
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
  },

  solana: {
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    wsUrl: process.env.SOLANA_WS_URL || 'wss://api.mainnet-beta.solana.com',
  },

  pyth: {
    hermesEndpoint: process.env.PYTH_HERMES_ENDPOINT || 'https://hermes.pyth.network',
  },

  crossmint: {
    serverApiKey: process.env.CROSSMINT_SERVER_API_KEY,
    signerSecret: process.env.CROSSMINT_SIGNER_SECRET,
    environment: process.env.CROSSMINT_ENVIRONMENT || 'production',
  },

  helius: {
    apiKey: process.env.HELIUS_API_KEY,
  },

  lulo: {
    apiKey: process.env.LULO_API_KEY,
  },

  sanctum: {
    apiKey: process.env.SANCTUM_API_KEY,
  },

  // NVIDIA AI API (for DeepSeek and other models)
  nvidia: {
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    model: process.env.NVIDIA_MODEL || 'deepseek-ai/deepseek-v3.2',
  },

  // Admin Dashboard (Phase 1)
  admin: {
    jwtSecret: process.env.ADMIN_JWT_SECRET,
    accessTokenTtl: process.env.ADMIN_ACCESS_TOKEN_TTL || '15m',
    refreshTokenTtl: process.env.ADMIN_REFRESH_TOKEN_TTL || '7d',
    tempTokenTtl: process.env.ADMIN_TEMP_TOKEN_TTL || '5m',
    totpEncKey: process.env.ADMIN_TOTP_ENC_KEY, // 32-byte hex (64 chars)
    totpIssuer: process.env.ADMIN_TOTP_ISSUER || 'PinTool Admin',
    maxFailedLogins: parseInt(process.env.ADMIN_MAX_FAILED_LOGINS, 10) || 5,
    lockoutMinutes: parseInt(process.env.ADMIN_LOCKOUT_MINUTES, 10) || 15,
    ipAllowlist: process.env.ADMIN_IP_ALLOWLIST || '',
  },
});
