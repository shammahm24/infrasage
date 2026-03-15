import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { AuditRequestSchema } from "../schema";
import { invokeAudit } from "../bedrock";
import { runLocalAudit } from "../local-auditor";
import { validateUnifiedDiff } from "../diff-validator";
import { putAudit } from "../dynamodb";

const MAX_RETRIES = 1;

export async function handleAudit(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const parsed = AuditRequestSchema.safeParse(body);
    if (!parsed.success) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid request", details: parsed.error.message }),
      };
    }

    const { fileName, fileContent } = parsed.data;
    const mode = process.env.AUDITOR_MODE || "bedrock";
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const bedrockResponse =
          mode === "bedrock"
            ? await invokeAudit(fileContent)
            : runLocalAudit(fileName, fileContent);

        const violation_count = bedrockResponse.violations?.length ?? 0;
        const carbon_delta_total = bedrockResponse.carbon_delta_total ?? 0;
        const timestamp = new Date().toISOString();
        const patch = bedrockResponse.unified_diff_patch ?? "";

        if (violation_count === 0) {
          const audit_id = await putAudit({
            timestamp,
            alignment_score: bedrockResponse.alignment_score,
            violation_count,
            carbon_delta_total,
            patch_applied: false,
            file_name: fileName,
          });
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              audit_id,
              timestamp,
              alignment_score: bedrockResponse.alignment_score,
              violation_count,
              carbon_delta_total,
              violations: [],
              unified_diff_patch: "",
              patch_applied: false,
            }),
          };
        }

        const hasDiffLines =
          patch.includes("\n-") ||
          patch.startsWith("-") ||
          patch.includes("\n+") ||
          patch.startsWith("+");
        if (hasDiffLines) {
          const diffValidation = validateUnifiedDiff(patch, fileContent);
          if (!diffValidation.valid) {
            throw new Error(diffValidation.error ?? "Invalid diff");
          }
        }

        const audit_id = await putAudit({
          timestamp,
          alignment_score: bedrockResponse.alignment_score,
          violation_count,
          carbon_delta_total,
          patch_applied: false,
          file_name: fileName,
        });

        const patchToReturn = hasDiffLines ? bedrockResponse.unified_diff_patch : "";
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            audit_id,
            timestamp,
            alignment_score: bedrockResponse.alignment_score,
            violation_count,
            carbon_delta_total,
            violations: bedrockResponse.violations ?? [],
            unified_diff_patch: patchToReturn,
            patch_applied: false,
          }),
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error("[audit] inner catch", {
          attempt,
          message: lastError.message,
          stack: lastError.stack,
        });
        if (attempt === MAX_RETRIES) break;
      }
    }

    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        error: "Audit failed after retry",
        message: lastError?.message ?? "Unknown error",
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[audit] 500 internal error", { message, stack });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal error", message }),
    };
  }
}
