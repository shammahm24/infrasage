import type { BedrockAuditResponse } from "./schema";

function findLines(content: string, predicate: (line: string) => boolean): number[] {
  const lines = content.split("\n");
  const idxs: number[] = [];
  lines.forEach((l, i) => {
    if (predicate(l)) idxs.push(i);
  });
  return idxs;
}

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
  diffLines.push(`@@ -1,${lines.length} +1,${lines.length} @@`);

  const ec2Idxs = findLines(fileContent, (l) =>
    l.trim().startsWith('resource "aws_instance"')
  );
  if (ec2Idxs.length > 0 && !fileContent.includes("tags = {")) {
    const idx = ec2Idxs[0];
    diffLines.push(`-${lines[idx]}`);
    diffLines.push(`+${lines[idx]}`);
    diffLines.push("+  tags = {");
    diffLines.push('+    Environment = "demo"');
    diffLines.push("+    Owner       = \"InfraSage\"");
    diffLines.push("+  }");
  }

  const pabIdxs = findLines(fileContent, (l) =>
    l.includes("block_public_acls       = false")
  );
  pabIdxs.forEach((idx) => {
    diffLines.push(`-${lines[idx]}`);
    diffLines.push("+block_public_acls       = true");
  });

  const appliedViolations = violations.length;
  const alignment = Math.max(0, 100 - appliedViolations * 15);

  return {
    alignment_score: alignment,
    violations,
    unified_diff_patch: diffLines.join("\n"),
    carbon_delta_total: -appliedViolations * 0.1,
  };
}

