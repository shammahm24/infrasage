import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getSummary } from "../dynamodb";

export async function handleSummary(
  _event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    console.log("[summary] start");
    const summary = await getSummary();
    console.log("[summary] success", {
      average_alignment: summary.average_alignment,
      recentCount: summary.recent_audits.length,
    });
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(summary),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[summary] error", { message });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Summary failed", message }),
    };
  }
}
