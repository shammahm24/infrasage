import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { z } from "zod";
import { markPatchApplied } from "../dynamodb";

const BodySchema = z.object({
  resolvedViolationCount: z.number().int().nonnegative().optional(),
});

export async function handleMarkApplied(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  const path = event.path ?? event.resource ?? "";
  const segments = path.split("/").filter(Boolean);
  // Expecting /audit/{audit_id}/applied -> ["audit", "{audit_id}", "applied"]
  const audit_id = segments.length === 3 && segments[0] === "audit" && segments[2] === "applied"
    ? segments[1]
    : "";

  if (!audit_id) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid audit_id in path" }),
    };
  }

  try {
    const rawBody = event.body ? JSON.parse(event.body) : {};
    const parsed = BodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Invalid request body",
          details: parsed.error.message,
        }),
      };
    }

    const { resolvedViolationCount } = parsed.data;

    try {
      const updated = await markPatchApplied(audit_id, resolvedViolationCount);
      if (!updated) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: "Audit not found" }),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          audit_id,
          patch_applied: true,
          resolved_violation_count: resolvedViolationCount ?? 0,
        }),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to mark patch applied", message }),
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal error", message }),
    };
  }
}

