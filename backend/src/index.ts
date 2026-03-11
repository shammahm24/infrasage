import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { handleAudit } from "./handlers/audit";
import { handleSummary } from "./handlers/summary";
import { handleMarkApplied } from "./handlers/markApplied";

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const path = event.path ?? event.resource ?? "";
  const method = event.httpMethod || "";

  if (method === "POST" && (path.endsWith("/audit") || path === "/audit")) {
    return handleAudit(event);
  }
  if (
    method === "POST" &&
    path.startsWith("/audit/") &&
    path.endsWith("/applied")
  ) {
    return handleMarkApplied(event);
  }
  if (method === "GET" && (path.endsWith("/summary") || path === "/summary")) {
    return handleSummary(event);
  }

  return {
    statusCode: 404,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: "Not found" }),
  };
}
