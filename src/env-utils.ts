/**
 * Environment Variable Utilities
 *
 * Shared logic for resolving constructor parameters from environment variables.
 * Extracted from photon's config-docs.ts and lumina's photon-loader.ts.
 */

/**
 * Minimal constructor parameter info needed for env resolution.
 * Compatible with both photon-core's full ConstructorParam and
 * lumina's simplified version (which omits isPrimitive).
 */
export interface EnvConstructorParam {
  name: string;
  type: string;
  isOptional: boolean;
  hasDefault: boolean;
  defaultValue?: any;
}

/**
 * Info about a missing required parameter
 */
export interface MissingParamInfo {
  paramName: string;
  envVarName: string;
  type: string;
}

/**
 * Convert a photon name and parameter name to an environment variable name
 *
 * @example toEnvVarName('my-mcp', 'apiKey') → 'MY_MCP_API_KEY'
 */
export function toEnvVarName(photonName: string, paramName: string): string {
  const prefix = photonName.toUpperCase().replace(/-/g, '_');
  const suffix = paramName
    .replace(/([A-Z])/g, '_$1')
    .toUpperCase()
    .replace(/^_/, '');
  return `${prefix}_${suffix}`;
}

/**
 * Parse an environment variable string value to the appropriate type
 */
export function parseEnvValue(value: string, type: string): any {
  switch (type) {
    case 'number':
      return parseFloat(value);
    case 'boolean':
      return value.toLowerCase() === 'true';
    case 'string':
    default:
      return value;
  }
}

/**
 * Generate a sensible example value for a parameter based on its name and type
 */
export function generateExampleValue(paramName: string, paramType: string): string | null {
  const lowerName = paramName.toLowerCase();

  if (lowerName.includes('apikey') || lowerName.includes('api_key')) {
    return 'sk_your_api_key_here';
  }
  if (lowerName.includes('token') || lowerName.includes('secret')) {
    return 'your_secret_token';
  }
  if (lowerName.includes('url') || lowerName.includes('endpoint')) {
    return 'https://api.example.com';
  }
  if (lowerName.includes('host') || lowerName.includes('server')) {
    return 'localhost';
  }
  if (lowerName.includes('port')) {
    return '5432';
  }
  if (lowerName.includes('database') || lowerName.includes('db')) {
    return 'my_database';
  }
  if (lowerName.includes('user') || lowerName.includes('username')) {
    return 'admin';
  }
  if (lowerName.includes('password')) {
    return 'your_secure_password';
  }
  if (lowerName.includes('path') || lowerName.includes('dir')) {
    return '/path/to/directory';
  }
  if (lowerName.includes('name')) {
    return 'my-service';
  }
  if (lowerName.includes('region')) {
    return 'us-east-1';
  }
  if (paramType === 'boolean') {
    return 'true';
  }
  if (paramType === 'number') {
    return '3000';
  }

  return null;
}

/**
 * Generate documentation and example env vars for constructor parameters
 */
export function summarizeConstructorParams(
  params: EnvConstructorParam[],
  photonName: string,
): { docs: string; exampleEnv: Record<string, string> } {
  const docs = params
    .map((param) => {
      const envVarName = toEnvVarName(photonName, param.name);
      const required = !param.isOptional && !param.hasDefault;
      const status = required ? '[REQUIRED]' : '[OPTIONAL]';
      const defaultInfo = param.hasDefault
        ? ` (default: ${JSON.stringify(param.defaultValue)})`
        : '';
      const exampleValue = generateExampleValue(param.name, param.type);

      let line = `  • ${envVarName} ${status}`;
      line += `\n    Type: ${param.type}${defaultInfo}`;
      if (exampleValue) {
        line += `\n    Example: ${envVarName}="${exampleValue}"`;
      }
      return line;
    })
    .join('\n\n');

  const exampleEnv: Record<string, string> = {};
  params.forEach((param) => {
    const envVarName = toEnvVarName(photonName, param.name);
    if (!param.isOptional && !param.hasDefault) {
      exampleEnv[envVarName] =
        generateExampleValue(param.name, param.type) || `your-${param.name}`;
    }
  });

  return { docs, exampleEnv };
}

/**
 * Generate a user-friendly error message for missing configuration
 */
export function generateConfigErrorMessage(
  photonName: string,
  missing: MissingParamInfo[],
): string {
  const envVarList = missing
    .map((m) => `  • ${m.envVarName} (${m.paramName}: ${m.type})`)
    .join('\n');
  const exampleEnv = Object.fromEntries(
    missing.map((m) => [m.envVarName, `<your-${m.paramName}>`]),
  );

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  Configuration Warning: ${photonName} MCP

Missing required environment variables:
${envVarList}

Tools will fail until configuration is fixed.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

To fix, add environment variables to your MCP client config:

{
  "mcpServers": {
    "${photonName}": {
      "command": "npx",
      "args": ["@portel/photon", "${photonName}"],
      "env": ${JSON.stringify(exampleEnv, null, 8).replace(/\n/g, '\n      ')}
    }
  }
}

Or run: photon ${photonName} --config

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();
}

/**
 * Resolve constructor arguments from environment variables
 *
 * @returns values array (aligned with params) and configError string if any required params are missing
 */
export function resolveEnvArgs(
  params: EnvConstructorParam[],
  photonName: string,
): { values: any[]; missing: MissingParamInfo[] } {
  const values: any[] = [];
  const missing: MissingParamInfo[] = [];

  for (const param of params) {
    const envVarName = toEnvVarName(photonName, param.name);
    const envValue = process.env[envVarName];

    if (envValue !== undefined) {
      values.push(parseEnvValue(envValue, param.type));
    } else if (param.hasDefault || param.isOptional) {
      values.push(undefined);
    } else {
      missing.push({ paramName: param.name, envVarName, type: param.type });
      values.push(undefined);
    }
  }

  return { values, missing };
}
