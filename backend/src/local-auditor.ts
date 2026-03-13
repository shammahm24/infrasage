import type { BedrockAuditResponse } from "./schema";

export function runLocalAudit(
  fileName: string,
  fileContent: string
): BedrockAuditResponse {
  const violations: BedrockAuditResponse["violations"] = [];

  if (fileContent.includes('resource "aws_instance"')) {
    if (
      fileContent.includes('instance_type = "t3.large"') ||
      fileContent.includes('instance_type = "t3.xlarge"') ||
      fileContent.includes('instance_type = "m5.large"')
    ) {
      violations.push({
        message:
          "Instance type may be over-provisioned; consider t3.medium or t3.small.",
        severity: "medium",
      });
    }
    if (!fileContent.includes("tags = {")) {
      violations.push({
        message: "EC2 instance is missing tags.",
        severity: "high",
      });
    }
  }

  if (fileContent.includes("aws_s3_bucket_public_access_block")) {
    if (fileContent.includes("block_public_acls       = false")) {
      violations.push({
        message: "S3 bucket public access block is disabled.",
        severity: "high",
      });
    }
  }

  if (violations.length === 0) {
    return {
      alignment_score: 100,
      violations: [],
      unified_diff_patch: "",
      carbon_delta_total: 0,
    };
  }

  const lines = fileContent.split("\n");
  const diffLines: string[] = [];
  const addTags =
    !fileContent.includes("tags = {") &&
    lines.some((l) => l.trim().startsWith('resource "aws_instance"'));
  const fixPab = lines.some((l) => l.includes("block_public_acls       = false"));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isEc2Open =
      addTags && line.trim().startsWith('resource "aws_instance"') && line.includes("{");
    const isPabFalse = fixPab && line.includes("block_public_acls       = false");

    if (isEc2Open) {
      const indent = line.slice(0, line.length - line.trimStart().length);
      const innerIndent = indent + "  ";
      diffLines.push(`-${line}`);
      diffLines.push(`+${line}`);
      diffLines.push(`+${innerIndent}tags = {`);
      diffLines.push(`+${innerIndent}  Environment = "demo"`);
      diffLines.push(`+${innerIndent}  Owner       = "InfraSage"`);
      diffLines.push(`+${innerIndent}}`);
      continue;
    }
    if (isPabFalse) {
      diffLines.push(`-${line}`);
      diffLines.push(`+${line.replace("= false", "= true")}`);
      continue;
    }
    diffLines.push(` ${line}`);
  }
  const addedLines = addTags ? 4 : 0;
  diffLines.unshift(`@@ -1,${lines.length} +1,${lines.length + addedLines} @@`);

  const appliedViolations = violations.length;
  const alignment = Math.max(0, 100 - appliedViolations * 15);

  return {
    alignment_score: alignment,
    violations,
    unified_diff_patch: diffLines.join("\n"),
    carbon_delta_total: -appliedViolations * 0.1,
  };
}

