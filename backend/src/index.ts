import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { handleAudit } from "./handlers/audit";
import { handleSummary } from "./handlers/summary";
import { handleMarkApplied } from "./handlers/markApplied";

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const path = event.path ?? event.resource ?? "";
  const method = event.httpMethod || "";

  console.log("[router] start", {
    path,
    method,
    resource: event.resource,
    requestId: (event as any)?.requestContext?.requestId ?? null,
  });

  if (method === "POST" && (path.endsWith("/audit") || path === "/audit")) {
    console.log("[router] route", { target: "audit", path, method });
    return handleAudit(event);
  }
  if (
    method === "POST" &&
    path.startsWith("/audit/") &&
    path.endsWith("/applied")
  ) {
    console.log("[router] route", { target: "markApplied", path, method });
    return handleMarkApplied(event);
  }
  if (method === "GET" && (path.endsWith("/summary") || path === "/summary")) {
    console.log("[router] route", { target: "summary", path, method });
    return handleSummary(event);
  }

  console.log("[router] 404", { path, method });
  return {
    statusCode: 404,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: "Not found" }),
  };
}
