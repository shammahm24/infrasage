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
    const summary = await getSummary();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(summary),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Summary failed", message }),
    };
  }
}
