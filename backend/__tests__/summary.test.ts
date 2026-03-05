import type { APIGatewayProxyEvent } from "aws-lambda";
import { handleSummary } from "../src/handlers/summary";
import * as dynamoModule from "../src/dynamodb";

jest.mock("../src/dynamodb");

const mockGetSummary = dynamoModule.getSummary as jest.MockedFunction<
  typeof dynamoModule.getSummary
>;

function makeEvent(): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: "GET",
    isBase64Encoded: false,
    path: "/summary",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: "/summary",
    requestContext: {} as any,
  };
}

describe("handleSummary", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns 200 with summary on success", async () => {
    mockGetSummary.mockResolvedValueOnce({
      average_alignment: 90,
      trend_delta: 10,
      total_carbon_delta: 5,
      violations_resolved: 3,
      recent_audits: [],
    });

    const res = await handleSummary(makeEvent());
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.average_alignment).toBe(90);
  });

  it("returns 500 when summary fails", async () => {
    mockGetSummary.mockRejectedValueOnce(new Error("boom"));

    const res = await handleSummary(makeEvent());
    expect(res.statusCode).toBe(500);
  });
})

