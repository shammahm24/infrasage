import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { BedrockAuditResponseSchema, type BedrockAuditResponse } from "./schema";

// Use inference profile ID; direct model ID "amazon.nova-2-lite-v1:0" returns:
// "Invocation of model ID ... with on-demand throughput isn't supported. Retry with ... inference profile"
const BEDROCK_MODEL_ID = "global.amazon.nova-2-lite-v1:0";
const REGION = process.env.AWS_REGION || "us-east-2";

const client = new BedrockRuntimeClient({ region: REGION });

const SYSTEM_PROMPT = `You are a Terraform sustainability and governance auditor. Output ONLY valid JSON, no markdown, no explanation.

For the given Terraform file content, analyze it for sustainability and governance violations (e.g. inefficient resources, missing tags, non-compliant patterns). Return a JSON object with exactly these keys:

- alignment_score: number between 0 and 100 (100 = fully aligned with best practices)
- violations: array of objects, each with optional "message", "line", "severity"
- unified_diff_patch: a valid unified diff string that would fix the violations. Must include @@ hunk headers and lines starting with - (to remove) or + (to add). No other text.
- carbon_delta_total: number (optional, estimated carbon impact delta if patch applied)

Output only the JSON object, nothing else.`;

export async function invokeAudit(fileContent: string): Promise<BedrockAuditResponse> {
  const response = await client.send(
    new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        schemaVersion: "messages-v1",
        system: [{ text: SYSTEM_PROMPT }],
        messages: [
          {
            role: "user",
            content: [{ text: `Audit this Terraform file:\n\n${fileContent}` }],
          },
        ],
        inferenceConfig: {
          maxTokens: 4096,
          temperature: 0.2,
        },
      }),
    })
  );

  if (!response.body) {
    throw new Error("Empty Bedrock response body");
  }

  const bodyString = new TextDecoder().decode(response.body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyString);
  } catch {
    throw new Error("Bedrock response is not valid JSON");
  }

  // Nova returns output in messages[].content[].text
  let jsonStr = bodyString;
  if (parsed && typeof parsed === "object" && "output" in parsed) {
    const output = (parsed as { output?: { message?: { content?: Array<{ text?: string }> } } }).output;
    const text = output?.message?.content?.[0]?.text;
    if (text) jsonStr = text;
  } else if (parsed && typeof parsed === "object" && "content" in parsed) {
    const content = (parsed as { content?: Array<{ text?: string }> }).content;
    if (Array.isArray(content) && content[0]?.text) jsonStr = content[0].text;
  }

  let parsedResponse: unknown;
  try {
    parsedResponse = JSON.parse(jsonStr);
  } catch {
    throw new Error("Bedrock response is not valid JSON");
  }

  const result = BedrockAuditResponseSchema.safeParse(parsedResponse);
  if (!result.success) {
    throw new Error(`Invalid Bedrock schema: ${result.error.message}`);
  }
  return result.data;
}
