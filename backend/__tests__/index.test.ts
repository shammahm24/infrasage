import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { handler } from "../src/index";
import { handleAudit } from "../src/handlers/audit";
import { handleSummary } from "../src/handlers/summary";

jest.mock("../src/handlers/audit");
jest.mock("../src/handlers/summary");

const mockHandleAudit = handleAudit as jest.MockedFunction<typeof handleAudit>;
const mockHandleSummary = handleSummary as jest.MockedFunction<typeof handleSummary>;

function makeEvent(overrides: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: "/",
    requestContext: {} as any,
    ...overrides,
  };
}

describe("handler routing", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("routes POST /audit to handleAudit", async () => {
    const expected: APIGatewayProxyResult = {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
    mockHandleAudit.mockResolvedValueOnce(expected);

    const event = makeEvent({
      httpMethod: "POST",
      path: "/audit",
    });

    const result = await handler(event);
    expect(mockHandleAudit).toHaveBeenCalledWith(event);
    expect(result).toEqual(expected);
  });

  it("routes GET /summary to handleSummary", async () => {
    const expected: APIGatewayProxyResult = {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foo: "bar" }),
    };
    mockHandleSummary.mockResolvedValueOnce(expected);

    const event = makeEvent({
      httpMethod: "GET",
      path: "/summary",
    });

    const result = await handler(event);
    expect(mockHandleSummary).toHaveBeenCalledWith(event);
    expect(result).toEqual(expected);
  });

  it("returns 404 for unknown route", async () => {
    const event = makeEvent({
      httpMethod: "GET",
      path: "/unknown",
    });

    const result = await handler(event);
    expect(result.statusCode).toBe(404);
  });
})

