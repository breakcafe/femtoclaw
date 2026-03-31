#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# SSE Scenario Test Suite — measures first-byte and end-to-end latency
# across simple, complex, MCP, and skill scenarios.
#
# Usage: ./scripts/test-sse-scenarios.sh
# Requires: running femtoclaw server on localhost:9000
# ─────────────────────────────────────────────────────────
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:9000}"
TOKEN="${API_TOKEN:-}"
AUTH_HEADER=""
[[ -n "$TOKEN" ]] && AUTH_HEADER="Authorization: Bearer ${TOKEN}"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'
YELLOW='\033[1;33m'; DIM='\033[2m'; NC='\033[0m'

PASS=0; FAIL=0; TOTAL=0
declare -a ROWS=()

header() { echo -e "\n${CYAN}═══ $* ═══${NC}"; }

# ── SSE request with timing ──
# Usage: sse_test "label" '{"message":"..."}' [expected_events...]
sse_test() {
  local label="$1"
  local body="$2"
  shift 2
  local expected_events=("$@")

  TOTAL=$((TOTAL+1))
  local tmpfile; tmpfile=$(mktemp)
  local timefile; timefile=$(mktemp)

  # Record wall-clock start
  local t_start
  t_start=$(python3 -c "import time; print(int(time.time()*1000))")

  # Fire SSE request; record time of first byte
  {
    curl -sN -X POST "${BASE_URL}/chat" \
      ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
      -H "Content-Type: application/json" \
      -H "X-User-Id: sse-test-user" \
      -d "$body" \
      --max-time 90 2>/dev/null &
    local curl_pid=$!

    # Wait for first byte
    local waited=0
    while [[ ! -s "$tmpfile" ]] && [[ $waited -lt 90000 ]]; do
      sleep 0.05
      waited=$((waited + 50))
    done
    python3 -c "import time; print(int(time.time()*1000))" > "$timefile"

    wait "$curl_pid" 2>/dev/null
  } > "$tmpfile"

  local t_first_byte; t_first_byte=$(cat "$timefile")
  local t_end; t_end=$(python3 -c "import time; print(int(time.time()*1000))")

  local ttfb=$((t_first_byte - t_start))
  local total_ms=$((t_end - t_start))

  # Count events
  local event_count; event_count=$(grep -c "^event:" "$tmpfile" 2>/dev/null || echo "0")
  local text_deltas; text_deltas=$(grep -c "^event: text_delta" "$tmpfile" 2>/dev/null || echo "0")
  local has_error; has_error=$(grep -c "^event: error" "$tmpfile" 2>/dev/null || echo "0")
  local has_complete; has_complete=$(grep -c "^event: message_complete" "$tmpfile" 2>/dev/null || echo "0")
  local has_tool_use; has_tool_use=$(grep -c "^event: tool_use" "$tmpfile" 2>/dev/null || echo "0")
  local has_tool_result; has_tool_result=$(grep -c "^event: tool_result" "$tmpfile" 2>/dev/null || echo "0")

  # Extract first text_delta content
  local first_text=""
  first_text=$(grep "^data:" "$tmpfile" | head -5 | python3 -c "
import sys, json
for line in sys.stdin:
    line = line.strip()
    if line.startswith('data:'):
        try:
            d = json.loads(line[5:])
            if 'text' in d and d['text'].strip():
                print(d['text'][:60].replace('\n',' '))
                break
        except: pass
" 2>/dev/null || echo "")

  # Determine pass/fail
  local status_icon
  if [[ "$has_error" -gt 0 ]]; then
    status_icon="${RED}✗${NC}"
    FAIL=$((FAIL+1))
    local err_msg
    err_msg=$(grep "^event: error" -A1 "$tmpfile" | grep "^data:" | head -1 | sed 's/^data://' | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','')[:80])" 2>/dev/null || echo "unknown")
    echo -e "  ${status_icon} ${label} ${DIM}[TTFB:${ttfb}ms total:${total_ms}ms]${NC}"
    echo -e "    ${RED}Error: ${err_msg}${NC}"
    ROWS+=("FAIL|${label}|${ttfb}|${total_ms}|${event_count}|${text_deltas}|error")
  elif [[ "$has_complete" -gt 0 ]]; then
    status_icon="${GREEN}✓${NC}"
    PASS=$((PASS+1))
    echo -e "  ${status_icon} ${label} ${DIM}[TTFB:${ttfb}ms total:${total_ms}ms events:${event_count} deltas:${text_deltas}]${NC}"
    [[ -n "$first_text" ]] && echo -e "    ${DIM}\"${first_text}\"${NC}"
    [[ "$has_tool_use" -gt 0 ]] && echo -e "    ${YELLOW}tool_use:${has_tool_use} tool_result:${has_tool_result}${NC}"
    ROWS+=("PASS|${label}|${ttfb}|${total_ms}|${event_count}|${text_deltas}|ok")
  else
    status_icon="${YELLOW}?${NC}"
    FAIL=$((FAIL+1))
    echo -e "  ${status_icon} ${label} ${DIM}[TTFB:${ttfb}ms total:${total_ms}ms]${NC} — no message_complete"
    ROWS+=("FAIL|${label}|${ttfb}|${total_ms}|${event_count}|${text_deltas}|incomplete")
  fi

  rm -f "$tmpfile" "$timefile"
}

# ═══════════════════════════════════════════════════════
echo -e "${CYAN}════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  FEMTOCLAW SSE SCENARIO TEST SUITE${NC}"
echo -e "${CYAN}  $(date -u +%Y-%m-%dT%H:%M:%SZ)${NC}"
echo -e "${CYAN}════════════════════════════════════════════════════════${NC}"

# Quick health check
if ! curl -sf "${BASE_URL}/health" >/dev/null 2>&1; then
  echo -e "${RED}Server not ready at ${BASE_URL}${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Server healthy at ${BASE_URL}"

# ── 1. Simple Chat ──
header "1. Simple Chat (minimal prompt, no tools expected)"
sse_test "Greeting (你好)" \
  '{"message":"你好","stream":true}'

sse_test "One-word answer (say PONG)" \
  '{"message":"Reply with exactly the word PONG. Nothing else.","stream":true}'

# ── 2. Moderate Complexity ──
header "2. Moderate Complexity"
sse_test "Short explanation (什么是MCP)" \
  '{"message":"用一段话解释什么是 Model Context Protocol (MCP)","stream":true}'

sse_test "Multi-step reasoning" \
  '{"message":"If I have 3 apples and buy 5 more, then give away 2, how many do I have? Show your work briefly.","stream":true}'

# ── 3. Skill Trigger ──
header "3. Skill System"
sse_test "Skill trigger (example demo)" \
  '{"message":"show me an example demo of skills","stream":true,"show_tool_use":true}'

# ── 4. Memory Tool ──
header "4. Memory Tool"
sse_test "Memory write + confirm" \
  '{"message":"请记住：我是一名产品设计师，在北京工作。","stream":true,"show_tool_use":true}'

sse_test "Memory recall" \
  '{"message":"你还记得我的职业吗？","stream":true,"show_tool_use":true}'

# ── 5. Multi-turn Conversation ──
header "5. Multi-turn (reuses conversation_id)"

# First turn
CONV_RESULT=$(curl -s -X POST "${BASE_URL}/chat" \
  ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
  -H "Content-Type: application/json" \
  -H "X-User-Id: sse-test-user" \
  -d '{"message":"My favorite color is blue. Remember that.","stream":false}' \
  --max-time 60 2>/dev/null)
CONV_ID=$(echo "$CONV_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('conversation_id',''))" 2>/dev/null || echo "")

if [[ -n "$CONV_ID" ]]; then
  echo -e "  ${DIM}Created conversation: ${CONV_ID}${NC}"
  sse_test "Multi-turn follow-up (recall from history)" \
    "{\"message\":\"What is my favorite color?\",\"conversation_id\":\"${CONV_ID}\",\"stream\":true}"
else
  echo -e "  ${RED}Failed to create conversation for multi-turn test${NC}"
fi

# ── 6. MCP (Microsoft Learn) ──
header "6. MCP — Microsoft Learn"
sse_test "MCP: search Azure docs" \
  '{"message":"Search Microsoft docs for Azure Functions Node.js quickstart","stream":true,"show_tool_use":true,"mcp_servers":{"ms-learn":{"type":"http","url":"https://learn.microsoft.com/api/mcp"}}}'

# ── 7. WebFetch ──
header "7. WebFetch Tool"
sse_test "WebFetch: fetch a URL" \
  '{"message":"Fetch https://httpbin.org/get and tell me the origin IP","stream":true,"show_tool_use":true}'

# ── 8. Complex (MCP + longer response) ──
header "8. Complex Scenario (MCP + analysis)"
sse_test "MCP + analysis: Azure pricing" \
  '{"message":"Search Microsoft docs for Azure Functions pricing and summarize the free tier limits in 3 bullet points","stream":true,"show_tool_use":true,"mcp_servers":{"ms-learn":{"type":"http","url":"https://learn.microsoft.com/api/mcp"}}}'

# ═══════════════════════════════════════════════════════
# Summary
echo -e "\n${CYAN}════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  RESULTS: ${PASS} passed, ${FAIL} failed (${TOTAL} total)${NC}"
echo -e "${CYAN}════════════════════════════════════════════════════════${NC}"

echo -e "\n${CYAN}Timing Table:${NC}"
printf "  %-45s %8s %8s %6s %6s %s\n" "Scenario" "TTFB" "Total" "Events" "Deltas" "Status"
printf "  %-45s %8s %8s %6s %6s %s\n" "─────────────────────────────────────────────" "────────" "────────" "──────" "──────" "──────"
for row in "${ROWS[@]}"; do
  IFS='|' read -r st name ttfb total evts deltas note <<< "$row"
  local_color="${GREEN}"
  [[ "$st" == "FAIL" ]] && local_color="${RED}"
  printf "  ${local_color}%-45s %6sms %6sms %6s %6s %s${NC}\n" "$name" "$ttfb" "$total" "$evts" "$deltas" "$note"
done

# Cleanup test conversations
if [[ -n "${CONV_ID:-}" ]]; then
  curl -s -X DELETE "${BASE_URL}/chat/${CONV_ID}" \
    ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
    -H "X-User-Id: sse-test-user" >/dev/null 2>&1
fi
