export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    notifyEnabled: process.env.TELEGRAM_NOTIFY_ENABLED === 'true',
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL,
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
});
