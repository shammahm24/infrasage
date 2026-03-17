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

/** Try to parse JSON from model output; handles markdown-wrapped or leading/trailing text. */
function parseJsonFromModelOutput(raw: string): unknown | null {
  let s = raw.trim();
  const codeFence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/;
  const match = s.match(codeFence);
  if (match) s = match[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const SYSTEM_PROMPT = `You are a Terraform sustainability and governance auditor. Output ONLY valid JSON, no markdown, no explanation.

For the given Terraform file content, analyze it for sustainability and governance violations (e.g. inefficient resources, missing tags, non-compliant patterns). Return a JSON object with exactly these keys:

- alignment_score: number between 0 and 100 (100 = fully aligned with best practices)
- violations: array of objects, each with optional "message", "line", "severity"
- unified_diff_patch: a valid unified diff string that would fix the violations. Must include @@ hunk headers and lines starting with - (to remove) or + (to add). No other text.
- carbon_delta_total: number (optional, estimated carbon impact delta if patch applied)

Output only the JSON object, nothing else.`;

export async function invokeAudit(fileContent: string): Promise<BedrockAuditResponse> {
  console.log("[bedrock] invokeAudit start", {
    modelId: BEDROCK_MODEL_ID,
    region: REGION,
    contentLength: fileContent.length,
  });
  let response;
  try {
    response = await client.send(
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
  } catch (e) {
    console.error("[bedrock] InvokeModel failed", {
      message: e instanceof Error ? e.message : String(e),
      name: e instanceof Error ? e.name : undefined,
    });
    throw e;
  }

  if (!response.body) {
    throw new Error("Empty Bedrock response body");
  }

  const bodyString = new TextDecoder().decode(response.body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyString);
  } catch {
    console.error("[bedrock] body parse failed", { bodyPreview: bodyString.slice(0, 300) });
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

  const parsedResponse = parseJsonFromModelOutput(jsonStr);
  if (parsedResponse === null) {
    console.error("[bedrock] model output not valid JSON", { jsonStrPreview: jsonStr.slice(0, 500) });
    throw new Error("Bedrock response is not valid JSON");
  }

  const result = BedrockAuditResponseSchema.safeParse(parsedResponse);
  if (!result.success) {
    console.error("[bedrock] schema validation failed", {
      zodError: result.error.message,
      issues: result.error.issues,
      parsedKeys: parsedResponse && typeof parsedResponse === "object" ? Object.keys(parsedResponse) : [],
    });
    throw new Error(`Invalid Bedrock schema: ${result.error.message}`);
  }
  return result.data;
}
