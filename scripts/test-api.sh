#!/usr/bin/env bash
# InfraSage API Gateway curl tests.
# Usage: BASE=https://<api-id>.execute-api.<region>.amazonaws.com/prod ./scripts/test-api.sh
# Or: export BASE=... then ./scripts/test-api.sh

set -e
if [ -z "$BASE" ]; then
  echo "Set BASE to your API Gateway invoke URL (e.g. export BASE=https://xxx.execute-api.us-east-1.amazonaws.com/prod)"
  exit 1
fi

echo "=== 1. POST /audit ==="
AUDIT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE/audit" \
  -H "Content-Type: application/json" \
  -d '{"fileName":"main.tf","fileContent":"resource \"aws_instance\" \"example\" {}"}')
HTTP_BODY=$(echo "$AUDIT_RESPONSE" | sed '$d')
HTTP_CODE=$(echo "$AUDIT_RESPONSE" | tail -n 1)
echo "HTTP $HTTP_CODE"
echo "$HTTP_BODY" | jq . 2>/dev/null || echo "$HTTP_BODY"
if [ "$HTTP_CODE" != "200" ]; then
  echo "POST /audit expected 200, got $HTTP_CODE"
fi
AUDIT_ID=$(echo "$HTTP_BODY" | jq -r '.audit_id // empty')
echo ""

echo "=== 2. GET /summary ==="
curl -s "$BASE/summary" | jq .
echo ""

echo "=== 3. POST /audit/{audit_id}/applied ==="
if [ -n "$AUDIT_ID" ]; then
  curl -s -X POST "$BASE/audit/$AUDIT_ID/applied" \
    -H "Content-Type: application/json" \
    -d '{"resolvedViolationCount":1}' | jq .
else
  echo "Skipped (no audit_id from step 1). Set AUDIT_ID=your-id to test manually."
fi
echo ""

echo "=== 4. GET /summary (after mark applied) ==="
curl -s "$BASE/summary" | jq .
echo ""

echo "=== 5. 404 check ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/unknown")
echo "GET /unknown => $CODE (expect 404)"
if [ "$CODE" != "404" ]; then
  echo "Expected 404, got $CODE"
fi

echo ""
echo "Done."
