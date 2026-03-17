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

const SYSTEM_PROMPT = `You are an AWS cloud governance auditor reviewing Terraform (HCL) for alignment with the AWS Cloud Governance Framework.

Your goals:
- Identify and explain misalignments with AWS best practices across these domains:
  - Security & Compliance (IAM least privilege, encryption, network exposure, logging)
  - Cost Optimization (right-sized instances, sensible storage choices, avoiding obvious waste)
  - Reliability & Resilience (multi-AZ where appropriate, backups, failover signals)
  - Operational Excellence (tagging standards, observability, operability)
  - Sustainability (efficient instance families/sizes, avoiding idle or overprovisioned resources)

For the given Terraform file content, do ALL of the following:

1) Analyze for violations and improvement opportunities, especially for:
   - EC2 and compute:
     - Oversized or inefficient instance types for general workloads (e.g., t3.large where t3.medium would suffice).
     - Missing required tags such as Environment, Owner, Application, CostCenter.
   - S3:
     - Public access blocks incorrectly disabled (block_public_acls, block_public_policy, ignore_public_acls, restrict_public_buckets).
     - Missing encryption at rest (server_side_encryption_configuration or bucket-level settings).
   - General security/network:
     - Security groups allowing 0.0.0.0/0 on sensitive ports.
   - General governance:
     - Resources missing standard tags that would support cost allocation and ownership.

2) Return a JSON object with EXACTLY these top-level keys:
   - alignment_score: number between 0 and 100 (100 = fully aligned with AWS governance best practices)
   - violations: array of objects, each with optional "message", "line", "severity"
   - unified_diff_patch: a valid unified diff string that would fix the violations.
   - carbon_delta_total: number (optional, estimated carbon impact delta if patch applied)

3) Rules for "violations":
   - "message" should clearly describe the governance issue (e.g., "S3 bucket public access block is disabled", "Instance type t3.large may be oversized").
   - "severity" can be "low", "medium", or "high" based on governance impact.

4) Rules for "unified_diff_patch":
   - It MUST be a valid unified diff:
     - Include at least one @@ hunk header (for example: "@@ -1,3 +1,4 @@").
     - Use lines starting with:
       - " " for unchanged context lines,
       - "-" for lines to remove,
       - "+" for lines to add.
   - When you include a "-" line, it MUST match a line in the original file EXACTLY (including spaces and the full value). Do NOT truncate values or change attribute names. Copy the entire original line verbatim.
   - For "+" lines, you may add new lines as needed (for example, tags blocks or more secure configuration).
   - Prefer minimal, surgical patches:
     - Change only the specific lines required to fix governance issues.
     - Avoid re-emitting entire resources when a single line change suffices.
     - Do NOT duplicate whole resources; instead, modify existing ones in place.

5) Scoring guidance:
   - Start from 100 and subtract for each governance violation based on severity and impact.
   - Make the score intuitive: a file with only one low-severity improvement might still be 85–95; a file with multiple serious security and cost issues might be below 50.

Output ONLY the JSON object, no markdown, no explanation, no surrounding text.`;

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
  console.log("[bedrock] raw body", {
    bodyPreview: bodyString.slice(0, 500),
  });
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

  console.log("[bedrock] content text", {
    jsonStrPreview: jsonStr.slice(0, 500),
  });

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
