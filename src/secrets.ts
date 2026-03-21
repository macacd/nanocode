import { SSMClient, GetParametersCommand } from "@aws-sdk/client-ssm";

const SSM_PREFIX = "/nanocode/";
const SECRETS = [
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENCODE_ZEN_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN"
];

/**
 * Loads secrets from AWS SSM Parameter Store and injects them into process.env.
 * Only runs if executing in AWS environment (checked via AWS_REGION or ec2 instance metadata).
 */
export async function loadSecrets(): Promise<void> {
  // If no explicit region is set, assume we might be running locally and skip unless forced
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  
  if (!region && process.env.NODE_ENV !== 'production' && !process.env.FORCE_SSM) {
    console.log("⏭️  Not explicitly in AWS environment, skipping SSM secrets.");
    return;
  }

  try {
    console.log(`🔐 Loading secrets from AWS SSM in region ${region || 'eu-west-1'}...`);
    
    // Create client (uses instance profile credentials automatically)
    const client = new SSMClient({ region: region || "eu-west-1" });
    
    const parameterNames = SECRETS.map(s => `${SSM_PREFIX}${s}`);
    
    const command = new GetParametersCommand({
      Names: parameterNames,
      WithDecryption: true,
    });

    const response = await client.send(command);
    
    let loadedCount = 0;
    
    for (const param of response.Parameters || []) {
      const envName = param.Name?.replace(SSM_PREFIX, "");
      if (envName && param.Value) {
        process.env[envName] = param.Value;
        loadedCount++;
      }
    }

    console.log(`✅ Loaded ${loadedCount} secrets from SSM Parameter Store`);

    if (response.InvalidParameters && response.InvalidParameters.length > 0) {
      console.log(`⚠️  Some parameters were not found in SSM:`);
      response.InvalidParameters.forEach(p => console.log(`   - ${p}`));
    }
  } catch (error: any) {
    console.error(`❌ Failed to load secrets from SSM: ${error.message}`);
    console.log(`   Proceeding with local environment variables.`);
  }
}
