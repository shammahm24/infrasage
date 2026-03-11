import {
  DynamoDBClient,
  PutItemCommand,
  ScanCommand,
  UpdateItemCommand,
  ConditionalCheckFailedException,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { v4 as uuidv4 } from "uuid";
import type { AuditRecord, SummaryApiResponse } from "./schema";

const TABLE_NAME = process.env.AUDITS_TABLE_NAME || "InfraSage_Audits";
const client = new DynamoDBClient({});

export async function putAudit(
  record: Omit<AuditRecord, "audit_id">
): Promise<string> {
  const audit_id = uuidv4();
  const item: AuditRecord = {
    ...record,
    audit_id,
  };
  await client.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall(item, { removeUndefinedValues: true }),
    })
  );
  return audit_id;
}

export async function getSummary(): Promise<SummaryApiResponse> {
  const result = await client.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      ProjectionExpression:
        "audit_id, #ts, alignment_score, violation_count, carbon_delta_total, patch_applied, resolved_violation_count",
      ExpressionAttributeNames: { "#ts": "timestamp" },
    })
  );

  const items = (result.Items || []).map((item) => {
    const u = item as Record<string, unknown>;
    return {
      audit_id: u.audit_id as string,
      timestamp: u.timestamp as string,
      alignment_score: Number(u.alignment_score),
      violation_count: Number(u.violation_count ?? 0),
      carbon_delta_total: Number(u.carbon_delta_total ?? 0),
      patch_applied: Boolean(u.patch_applied),
      resolved_violation_count: Number(u.resolved_violation_count ?? 0),
    };
  });

  const sorted = items.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const last10 = sorted.slice(0, 10);
  const last5 = sorted.slice(0, 5);

  const average_alignment =
    last10.length > 0
      ? last10.reduce((s, i) => s + i.alignment_score, 0) / last10.length
      : 0;

  const trend_delta =
    last10.length >= 2
      ? last10[0].alignment_score - last10[last10.length - 1].alignment_score
      : 0;

  const applied = items.filter((i) => i.patch_applied);
  const total_carbon_delta = applied.reduce(
    (s, i) => s + (i.carbon_delta_total ?? 0),
    0
  );
  const violations_resolved = applied.reduce(
    (s, i) => s + (i.resolved_violation_count ?? 0),
    0
  );

  return {
    average_alignment: Math.round(average_alignment * 100) / 100,
    trend_delta,
    total_carbon_delta,
    violations_resolved,
    recent_audits: last5.map((i) => ({
      audit_id: i.audit_id,
      timestamp: i.timestamp,
      alignment_score: i.alignment_score,
      violation_count: i.violation_count,
      patch_applied: i.patch_applied,
    })),
  };
}

export async function markPatchApplied(
  auditId: string,
  resolvedViolationCount?: number
): Promise<boolean> {
  const expressionParts = ["patch_applied = :true"];
  const expressionValues: Record<string, any> = {
    ":true": { BOOL: true },
  };

  if (typeof resolvedViolationCount === "number") {
    expressionParts.push("resolved_violation_count = :resolved");
    expressionValues[":resolved"] = { N: resolvedViolationCount.toString() };
  }

  try {
    await client.send(
      new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: {
          audit_id: { S: auditId },
        },
        UpdateExpression: `SET ${expressionParts.join(", ")}`,
        ExpressionAttributeValues: expressionValues,
        ConditionExpression: "attribute_exists(audit_id)",
      })
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return false;
    }
    throw err;
  }
}

