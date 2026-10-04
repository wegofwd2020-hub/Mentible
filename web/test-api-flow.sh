#!/bin/bash
# Test common-projects API flow
# Usage: bash test-api-flow.sh <auth-token>

set -e

API_URL="https://mambakkam.net/mentible-api"
TOKEN="${1}"

if [ -z "$TOKEN" ]; then
  echo "Usage: bash test-api-flow.sh <auth-token>"
  echo ""
  echo "Get token from mobile app:"
  echo "  1. Sign in on mobile app"
  echo "  2. Check browser DevTools → Storage → localStorage → 'sb-mentible-app-auth-token'"
  echo "  3. Pass here: bash test-api-flow.sh 'your-token-here'"
  exit 1
fi

echo "=== Testing Common Projects API Flow ==="
echo ""

echo "1️⃣  LIST common projects (no auth needed)"
echo "GET $API_URL/api/v1/trust/common-projects"
curl -s "$API_URL/api/v1/trust/common-projects" | jq '.' || echo "Failed to list"
echo ""

echo "2️⃣  PUBLISH test common project (requires auth)"
TEST_PROJECT=$(cat <<'EOF'
{
  "title": "Test Common Project",
  "description": "Created by test script",
  "project_data": {
    "toc": {
      "subjects": [
        {
          "subject_label": "Introduction",
          "units": [
            {
              "id": "unit-1",
              "title": "Getting Started",
              "subtopics": [],
              "prerequisites": []
            }
          ]
        }
      ]
    }
  }
}
EOF
)

echo "POST $API_URL/api/v1/trust/common-projects"
PUBLISH_RESPONSE=$(curl -s -X POST "$API_URL/api/v1/trust/common-projects" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "$TEST_PROJECT")

echo "$PUBLISH_RESPONSE" | jq '.' || echo "Failed to publish: $PUBLISH_RESPONSE"

# Extract project ID if successful
PROJECT_ID=$(echo "$PUBLISH_RESPONSE" | jq -r '.id // empty' 2>/dev/null)
if [ -n "$PROJECT_ID" ] && [ "$PROJECT_ID" != "null" ]; then
  echo ""
  echo "✓ Published successfully! Project ID: $PROJECT_ID"
  echo ""

  echo "3️⃣  LIST again (should now have the test project)"
  curl -s "$API_URL/api/v1/trust/common-projects" | jq '.'
  echo ""

  echo "4️⃣  GET detail of test project"
  echo "GET $API_URL/api/v1/trust/common-projects/$PROJECT_ID"
  curl -s "$API_URL/api/v1/trust/common-projects/$PROJECT_ID" | jq '.' || echo "Failed to get detail"
  echo ""

  echo "✅ Test project created! Visit http://localhost:5173/trust/common to see it in the web app"
else
  echo ""
  echo "❌ Failed to publish (check token is valid)"
  exit 1
fi
