#!/usr/bin/env zsh
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <AIRPORT_CODE> <AIRPORT_SECURITY_URL>"
  echo "Example: $0 MCO https://flymco.com/security/"
  exit 1
fi

AIRPORT_CODE="${1:u}"
AIRPORT_SECURITY_URL="$2"

PROMPT=$(cat <<EOF
You are in LOW-CREDIT mode. Do not run expensive/redundant checks.

Task:
Onboard a new airport live TSA source into my existing Flask project with minimal tool usage.

Inputs:
- Airport code: ${AIRPORT_CODE}
- Airport security URL: ${AIRPORT_SECURITY_URL}
- Repo path: /Users/benbirkhahn/tsa-live-site
- Branch: main

Strict constraints:
1) Minimize credits:
   - Max 1 static source scan pass
   - Max 1 dynamic network trace pass (Playwright only if static fails)
   - No repeated verification loops
   - No broad crawling
2) Stop as soon as a stable live endpoint + required headers are confirmed.
3) Implement only necessary changes.
4) Keep existing routes/UI working.
5) Commit + push when done.
6) Include \`Co-Authored-By: Oz <oz-agent@warp.dev>\` in commit message.

Required output flow:
A) Discovery result (short):
   - endpoint URL
   - required headers
   - auth mechanism (public, api key, rotating key, etc.)
   - confidence (high/medium/low)

B) Code changes:
   - Add airport to LIVE_AIRPORTS
   - Remove from PIPELINE_AIRPORTS
   - Add collector fetch function
   - Add collector to polling list
   - Add any minimal cache/key refresh logic if needed
   - Update live header badge only if present

C) Validation (minimal):
   - One local collector check
   - One /api/tsa-wait-times?code=${AIRPORT_CODE} check
   - One /api/history?airport=${AIRPORT_CODE} check

D) Deploy:
   - commit
   - push main
   - one production check of /api/tsa-wait-times?code=${AIRPORT_CODE}

E) Final report (short):
   - commit hash
   - files changed
   - whether production is live_direct yet or waiting for redeploy
EOF
)

print -r -- "$PROMPT" | pbcopy
echo "Prompt copied to clipboard for airport: ${AIRPORT_CODE}"
