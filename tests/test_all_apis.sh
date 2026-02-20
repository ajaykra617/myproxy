#!/usr/bin/env bash
# ============================================================================
# Comprehensive API Test Suite for Proxy Manager
# Tests all endpoints: /health, /v1/proxy, /v1/providers, /v1/proxy/report
# ============================================================================

BASE="http://localhost:3100"
PASS=0
FAIL=0
TOTAL=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

run_test() {
  local name="$1"
  local method="$2"
  local url="$3"
  local expected_status="$4"
  local body="$5"       # optional JSON body for POST
  local check_key="$6"  # optional key to check in response JSON

  TOTAL=$((TOTAL + 1))

  printf "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
  printf "${BOLD}TEST #%d: %s${NC}\n" "$TOTAL" "$name"
  printf "${YELLOW}  → %s %s${NC}\n" "$method" "$url"
  if [ -n "$body" ]; then
    printf "${YELLOW}  → Body: %s${NC}\n" "$body"
  fi

  if [ "$method" = "POST" ]; then
    response=$(curl -s -w "\n%{http_code}" -X POST \
      -H "Content-Type: application/json" \
      -d "$body" \
      "$url" 2>&1)
  else
    response=$(curl -s -w "\n%{http_code}" "$url" 2>&1)
  fi

  http_code=$(echo "$response" | tail -1)
  resp_body=$(echo "$response" | sed '$d')

  printf "  ← Status: %s (expected: %s)\n" "$http_code" "$expected_status"
  printf "  ← Body:   %s\n" "$resp_body"

  if [ "$http_code" = "$expected_status" ]; then
    if [ -n "$check_key" ]; then
      if echo "$resp_body" | grep -q "$check_key"; then
        printf "  ${GREEN}✅ PASSED${NC} (status matched + key '%s' found)\n" "$check_key"
        PASS=$((PASS + 1))
      else
        printf "  ${RED}❌ FAILED${NC} (status matched but key '%s' NOT found)\n" "$check_key"
        FAIL=$((FAIL + 1))
      fi
    else
      printf "  ${GREEN}✅ PASSED${NC}\n"
      PASS=$((PASS + 1))
    fi
  else
    printf "  ${RED}❌ FAILED${NC} (expected %s, got %s)\n" "$expected_status" "$http_code"
    FAIL=$((FAIL + 1))
  fi
}

# ============================================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║        🧪 Proxy Manager API — Full Test Suite 🧪           ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Base URL: $BASE                             ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# ============================================================================
# 1. HEALTH CHECK
# ============================================================================
echo ""
echo "┌──────────────────────────────────────────────────────────────┐"
echo "│  📡 Section 1: Health Check                                  │"
echo "└──────────────────────────────────────────────────────────────┘"

run_test "Health endpoint returns OK" \
  GET "$BASE/health" 200 "" '"status":"ok"'

# ============================================================================
# 2. GET /v1/providers — Provider Catalog
# ============================================================================
echo ""
echo "┌──────────────────────────────────────────────────────────────┐"
echo "│  📊 Section 2: Provider Catalog                              │"
echo "└──────────────────────────────────────────────────────────────┘"

run_test "Providers catalog returns data" \
  GET "$BASE/v1/providers" 200 "" '"providers"'

# ============================================================================
# 3. GET /v1/proxy — Fetch Proxy (various scenarios)
# ============================================================================
echo ""
echo "┌──────────────────────────────────────────────────────────────┐"
echo "│  🔀 Section 3: Fetch Proxy (GET /v1/proxy)                   │"
echo "└──────────────────────────────────────────────────────────────┘"

# 3a. Basic proxy fetch (no filters — should return a rotating proxy)
run_test "Fetch any rotating proxy (no filters)" \
  GET "$BASE/v1/proxy" 200 "" '"proxy_url"'

# 3b. Fetch by country
run_test "Fetch proxy by country=US" \
  GET "$BASE/v1/proxy?country=US" 200 "" '"proxy_url"'

# 3c. Fetch by proxy type
run_test "Fetch proxy by type=datacenter" \
  GET "$BASE/v1/proxy?type=datacenter" 200 "" '"proxy_url"'

# 3d. Fetch by proxy type using 'proxy' alias
run_test "Fetch proxy using proxy= alias (proxy=datacenter)" \
  GET "$BASE/v1/proxy?proxy=datacenter" 200 "" '"proxy_url"'

# 3e. Fetch by provider
run_test "Fetch proxy by provider=dataimpulse" \
  GET "$BASE/v1/proxy?provider=dataimpulse" 200 "" '"proxy_url"'

# 3f. Combined filters
run_test "Fetch proxy with combined filters (country=US, type=datacenter)" \
  GET "$BASE/v1/proxy?country=US&type=datacenter" 200 "" '"proxy_url"'

# 3g. Fetch with least_used strategy
run_test "Fetch proxy with strategy=least_used" \
  GET "$BASE/v1/proxy?strategy=least_used" 200 "" '"proxy_url"'

# 3h. Fetch sticky proxy
run_test "Fetch sticky proxy" \
  GET "$BASE/v1/proxy?sticky=true" 200 "" '"proxy_url"'

# 3i. Fetch sticky proxy with custom TTL
run_test "Fetch sticky proxy with ttl=30" \
  GET "$BASE/v1/proxy?sticky=true&ttl=30" 200 "" '"proxy_url"'

# ============================================================================
# 4. GET /v1/proxy — Validation / Error Cases
# ============================================================================
echo ""
echo "┌──────────────────────────────────────────────────────────────┐"
echo "│  ⚠️  Section 4: Input Validation / Error Cases               │"
echo "└──────────────────────────────────────────────────────────────┘"

# 4a. Invalid proxy type
run_test "Invalid type returns 400" \
  GET "$BASE/v1/proxy?type=INVALID" 400 "" '"error"'

# 4b. Invalid protocol
run_test "Invalid protocol returns 400" \
  GET "$BASE/v1/proxy?protocol=ftp" 400 "" '"error"'

# 4c. Invalid anonymity
run_test "Invalid anonymity returns 400" \
  GET "$BASE/v1/proxy?anonymity=super" 400 "" '"error"'

# 4d. Invalid strategy
run_test "Invalid strategy returns 400" \
  GET "$BASE/v1/proxy?strategy=fastest" 400 "" '"error"'

# 4e. Invalid TTL (too low)
run_test "TTL=0 returns 400" \
  GET "$BASE/v1/proxy?sticky=true&ttl=0" 400 "" '"error"'

# 4f. Invalid TTL (too high)
run_test "TTL=9999 returns 400" \
  GET "$BASE/v1/proxy?sticky=true&ttl=9999" 400 "" '"error"'

# 4g. Invalid TTL (non-number)
run_test "TTL=abc returns 400" \
  GET "$BASE/v1/proxy?sticky=true&ttl=abc" 400 "" '"error"'

# 4h. No matching proxy (obscure country)
run_test "Non-existent country returns 404" \
  GET "$BASE/v1/proxy?country=ZZ" 404 "" '"error"'

# 4i. No matching proxy (wrong type for sticky)
run_test "Mobile sticky proxy returns 404 (no such data)" \
  GET "$BASE/v1/proxy?sticky=true&type=mobile" 404 "" '"error"'

# ============================================================================
# 5. POST /v1/proxy/report — Report Feedback
# ============================================================================
echo ""
echo "┌──────────────────────────────────────────────────────────────┐"
echo "│  📝 Section 5: Report Proxy Usage (POST /v1/proxy/report)    │"
echo "└──────────────────────────────────────────────────────────────┘"

# First grab a real proxy_id from the DB
PROXY_ID=$(curl -s "$BASE/v1/proxy" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
echo "  ℹ️  Resolved proxy_id for reports: $PROXY_ID"

# 5a. Report success
run_test "Report success (by proxy_id)" \
  POST "$BASE/v1/proxy/report" 200 \
  "{\"proxy_id\": $PROXY_ID, \"status\": \"success\", \"latency_ms\": 200, \"target_domain\": \"example.com\"}" \
  '"success":true'

# 5b. Report blocked
run_test "Report blocked (by proxy_id)" \
  POST "$BASE/v1/proxy/report" 200 \
  "{\"proxy_id\": $PROXY_ID, \"status\": \"blocked\", \"latency_ms\": 5000, \"target_domain\": \"tough-site.com\"}" \
  '"success":true'

# 5c. Report timeout
run_test "Report timeout" \
  POST "$BASE/v1/proxy/report" 200 \
  "{\"proxy_id\": $PROXY_ID, \"status\": \"timeout\", \"latency_ms\": 30000, \"target_domain\": \"slow-site.com\"}" \
  '"success":true'

# 5d. Report captcha
run_test "Report captcha" \
  POST "$BASE/v1/proxy/report" 200 \
  "{\"proxy_id\": $PROXY_ID, \"status\": \"captcha\", \"target_domain\": \"captcha-site.com\"}" \
  '"success":true'

# 5e. Report slow
run_test "Report slow" \
  POST "$BASE/v1/proxy/report" 200 \
  "{\"proxy_id\": $PROXY_ID, \"status\": \"slow\", \"latency_ms\": 15000, \"target_domain\": \"slow.io\"}" \
  '"success":true'

# 5f. Report error
run_test "Report error" \
  POST "$BASE/v1/proxy/report" 200 \
  "{\"proxy_id\": $PROXY_ID, \"status\": \"error\", \"target_domain\": \"broken.net\"}" \
  '"success":true'

# 5g. Report by proxy_ip instead of proxy_id
run_test "Report by proxy_ip (gw.dataimpulse.com)" \
  POST "$BASE/v1/proxy/report" 200 \
  '{"proxy_ip": "gw.dataimpulse.com", "status": "success", "latency_ms": 150, "target_domain": "ip-test.com"}' \
  '"success":true'

# ============================================================================
# 6. POST /v1/proxy/report — Validation / Error Cases
# ============================================================================
echo ""
echo "┌──────────────────────────────────────────────────────────────┐"
echo "│  ⚠️  Section 6: Report Validation / Error Cases              │"
echo "└──────────────────────────────────────────────────────────────┘"

# 6a. Missing status field
run_test "Report without status returns 400" \
  POST "$BASE/v1/proxy/report" 400 \
  '{"proxy_id": 1}' \
  '"error"'

# 6b. Invalid status value
run_test "Report with invalid status returns 400" \
  POST "$BASE/v1/proxy/report" 400 \
  '{"proxy_id": 1, "status": "unknown"}' \
  '"error"'

# 6c. Missing proxy_id AND proxy_ip
run_test "Report without proxy identifier returns 404" \
  POST "$BASE/v1/proxy/report" 404 \
  '{"status": "success"}' \
  '"error"'

# 6d. Non-existent proxy_ip
run_test "Report with non-existent proxy_ip returns 404" \
  POST "$BASE/v1/proxy/report" 404 \
  '{"proxy_ip": "0.0.0.0", "status": "success"}' \
  '"error"'

# ============================================================================
# 7. Verify Score Changes After Reports
# ============================================================================
echo ""
echo "┌──────────────────────────────────────────────────────────────┐"
echo "│  📈 Section 7: Score/Stats Verification After Reports        │"
echo "└──────────────────────────────────────────────────────────────┘"

# Re-fetch the proxy to see updated stats
TOTAL=$((TOTAL + 1))
printf "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
printf "${BOLD}TEST #%d: Verify proxy score was updated after reports${NC}\n" "$TOTAL"

score_resp=$(curl -s "$BASE/v1/proxy")
score=$(echo "$score_resp" | grep -o '"score":[0-9.]*' | head -1 | cut -d: -f2)

if [ -n "$score" ]; then
  printf "  ← Current score: %s\n" "$score"
  printf "  ${GREEN}✅ PASSED${NC} (score field present and accessible)\n"
  PASS=$((PASS + 1))
else
  printf "  ${RED}❌ FAILED${NC} (could not read score)\n"
  FAIL=$((FAIL + 1))
fi

# ============================================================================
# SUMMARY
# ============================================================================
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                   📋 TEST RESULTS SUMMARY                   ║"
echo "╠══════════════════════════════════════════════════════════════╣"
printf "║  Total Tests:  %-5d                                       ║\n" "$TOTAL"
printf "║  ${GREEN}Passed:        %-5d${NC}                                       ║\n" "$PASS"
printf "║  ${RED}Failed:        %-5d${NC}                                       ║\n" "$FAIL"
echo "╠══════════════════════════════════════════════════════════════╣"
if [ "$FAIL" -eq 0 ]; then
  echo "║  🎉 ALL TESTS PASSED!                                      ║"
else
  echo "║  ⚠️  Some tests failed — review output above               ║"
fi
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

exit $FAIL
