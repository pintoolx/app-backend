export function getEnvOrThrow(envVarName: string): string {
  if (envVarName in process.env) {
    return process.env[envVarName] as string;
  }
  throw new Error(`Environment variable ${envVarName} is not set`);
}

export function getEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] || defaultValue;
}
