import type { APIGatewayProxyEvent } from "aws-lambda";
import { handleAudit } from "../src/handlers/audit";
import * as bedrockModule from "../src/bedrock";
import * as dynamoModule from "../src/dynamodb";

jest.mock("../src/bedrock");
jest.mock("../src/dynamodb");

const mockInvokeAudit = bedrockModule
  .invokeAudit as jest.MockedFunction<typeof bedrockModule.invokeAudit>;
const mockPutAudit = dynamoModule.putAudit as jest.MockedFunction<
  typeof dynamoModule.putAudit
>;

function makeEvent(body: unknown): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: "/audit",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: "/audit",
    requestContext: {} as any,
  };
}

describe("handleAudit", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns 400 for invalid request body", async () => {
    const event = makeEvent({ fileName: "main.tf" }); // missing fileContent
    const res = await handleAudit(event);
    expect(res.statusCode).toBe(400);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toBe("Invalid request");
  });

  it("returns 200 and persists audit on success", async () => {
    mockInvokeAudit.mockResolvedValueOnce({
      alignment_score: 80,
      violations: [{ message: "test", line: 1, severity: "medium" }],
      unified_diff_patch:
        "@@ -1,1 +1,1 @@\n-resource \"aws_instance\" \"x\" {}\n+resource \"aws_instance\" \"x\" { tags = {} }",
      carbon_delta_total: 1.23,
    });
    mockPutAudit.mockResolvedValueOnce("audit-123");

    const event = makeEvent({
      fileName: "main.tf",
      fileContent: 'resource "aws_instance" "x" {}',
    });

    const res = await handleAudit(event);
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.audit_id).toBe("audit-123");
    expect(parsed.alignment_score).toBe(80);
    expect(parsed.violation_count).toBe(1);
  });

  it("returns 502 when Bedrock/diff fails even after retry", async () => {
    mockInvokeAudit.mockResolvedValue({
      alignment_score: 80,
      violations: [{ message: "test", severity: "medium" }],
      unified_diff_patch: "@@ -1,1 +1,1 @@\n-does_not_exist\n+added",
      carbon_delta_total: 0,
    });

    const event = makeEvent({
      fileName: "main.tf",
      fileContent: 'resource "aws_instance" "x" {}',
    });

    const res = await handleAudit(event);
    expect(res.statusCode).toBe(502);
  });
})

