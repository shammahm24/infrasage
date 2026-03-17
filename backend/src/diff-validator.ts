/**
 * Validates unified_diff_patch from Bedrock per instructions:
 * - Patch must include "@@"
 * - Patch must include "-" or "+"
 * - Any "-" line must exist in the original file
 */
export function validateUnifiedDiff(
  patch: string,
  originalContent: string
): { valid: boolean; error?: string } {
  if (!patch || typeof patch !== "string") {
    return { valid: false, error: "unified_diff_patch missing" };
  }
  if (!patch.includes("@@")) {
    return { valid: false, error: "Patch lacks '@@'" };
  }
  const hasMinus = patch.includes("\n-") || patch.startsWith("-");
  const hasPlus = patch.includes("\n+") || patch.startsWith("+");
  if (!hasMinus && !hasPlus) {
    return { valid: false, error: "Patch lacks '-' or '+'" };
  }

  const originalLines = originalContent.split("\n");
  const lines = patch.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("-") && !line.startsWith("---")) {
      const removed = line.slice(1);
      const removedTrimmed = removed.trim();
      const exists = originalLines.some((orig) => {
        if (orig === removed) return true;
        if (orig.trim() === removedTrimmed) return true;
        return false;
      });
      if (!exists) {
        return {
          valid: false,
          error: `Line to remove not found in original: ${JSON.stringify(removed.slice(0, 80))}`,
        };
      }
    }
  }
  return { valid: true };
}
