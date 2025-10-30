export function getEnvOrThrow(envVarName) {
    if (envVarName in process.env) {
        return process.env[envVarName];
    }
    throw Error(`${envVarName} environment variable does not exist`);
}
//# sourceMappingURL=env.js.map