import { z } from "zod";

/** Request body for POST /audit */
export const AuditRequestSchema = z.object({
  fileName: z.string(),
  fileContent: z.string(),
});

export type AuditRequest = z.infer<typeof AuditRequestSchema>;

/** Single violation from Bedrock */
export const ViolationSchema = z.object({
  message: z.string().optional(),
  line: z.number().optional(),
  severity: z.string().optional(),
});

/** Expected Bedrock response shape (strict JSON) */
export const BedrockAuditResponseSchema = z.object({
  alignment_score: z.number().min(0).max(100),
  violations: z.array(ViolationSchema),
  unified_diff_patch: z.string(),
  carbon_delta_total: z.number().nullable().optional(),
});

export type BedrockAuditResponse = z.infer<typeof BedrockAuditResponseSchema>;

/** Item stored in DynamoDB */
export const AuditRecordSchema = z.object({
  audit_id: z.string(),
  timestamp: z.string(),
  alignment_score: z.number(),
  violation_count: z.number(),
  carbon_delta_total: z.number(),
  patch_applied: z.boolean(),
  resolved_violation_count: z.number().optional(),
  file_name: z.string().optional(),
});

export type AuditRecord = z.infer<typeof AuditRecordSchema>;

/** API response for POST /audit */
export interface AuditApiResponse {
  audit_id: string;
  timestamp: string;
  alignment_score: number;
  violation_count: number;
  carbon_delta_total: number;
  violations: Array<{ message?: string; line?: number; severity?: string }>;
  unified_diff_patch: string;
  patch_applied: boolean;
}

/** API response for GET /summary */
export interface SummaryApiResponse {
  average_alignment: number;
  trend_delta: number;
  total_carbon_delta: number;
  violations_resolved: number;
  recent_audits: Array<{
    audit_id: string;
    timestamp: string;
    alignment_score: number;
    violation_count: number;
    patch_applied: boolean;
  }>;
}
