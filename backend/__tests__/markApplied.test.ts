import type { APIGatewayProxyEvent } from "aws-lambda";
import { handleMarkApplied } from "../src/handlers/markApplied";
import * as dynamoModule from "../src/dynamodb";

jest.mock("../src/dynamodb");

const mockMarkPatchApplied = dynamoModule.markPatchApplied as jest.MockedFunction<
  typeof dynamoModule.markPatchApplied
>;

function makeEvent(
  path: string,
  body?: unknown
): APIGatewayProxyEvent {
  return {
    body: body !== undefined ? JSON.stringify(body) : null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path,
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: path,
    requestContext: {} as any,
  };
}

describe("handleMarkApplied", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns 400 for invalid path", async () => {
    const res = await handleMarkApplied(makeEvent("/audit//applied"));
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid body", async () => {
    const res = await handleMarkApplied(
      makeEvent("/audit/audit-123/applied", { resolvedViolationCount: "x" })
    );
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 when audit is not found", async () => {
    mockMarkPatchApplied.mockResolvedValueOnce(false);
    const res = await handleMarkApplied(
      makeEvent("/audit/audit-123/applied", { resolvedViolationCount: 2 })
    );
    expect(mockMarkPatchApplied).toHaveBeenCalledWith("audit-123", 2);
    expect(res.statusCode).toBe(404);
  });

  it("returns 200 when update succeeds", async () => {
    mockMarkPatchApplied.mockResolvedValueOnce(true);
    const res = await handleMarkApplied(
      makeEvent("/audit/audit-123/applied", { resolvedViolationCount: 3 })
    );
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.audit_id).toBe("audit-123");
    expect(parsed.patch_applied).toBe(true);
    expect(parsed.resolved_violation_count).toBe(3);
  });

  it("returns 500 when helper throws", async () => {
    mockMarkPatchApplied.mockRejectedValueOnce(new Error("boom"));
    const res = await handleMarkApplied(
      makeEvent("/audit/audit-123/applied", { resolvedViolationCount: 1 })
    );
    expect(res.statusCode).toBe(500);
  });
});

