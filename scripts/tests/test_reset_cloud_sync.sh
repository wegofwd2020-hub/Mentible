#!/usr/bin/env bash
# Tests for scripts/reset-cloud-sync.sh. Runs the real script against a fake
# curl (fixtures/bin/curl) that records calls and returns canned responses, so
# no network is touched. Usage: scripts/tests/test_reset_cloud_sync.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../reset-cloud-sync.sh"
TOKEN="sk-test-SECRET-TOKEN-123"
PASS=0; FAIL=0

# run <stdin-lines...> ; sets RC, OUT (stdout+stderr), LOG (stub calls)
run() {
  local log; log="$(mktemp)"
  OUT="$(printf '%s\n' "$@" | env PATH="$HERE/fixtures/bin:$PATH" STUB_LOG="$log" TEST_TOKEN="$TOKEN" \
        API_BASE="https://example.test/api/v1" "${RUN_ENV[@]}" bash "$SCRIPT" 2>&1)"
  RC=$?
  LOG="$(cat "$log")"; rm -f "$log"
  RUN_ENV=()
}
RUN_ENV=()

check() { # check <name> <condition-exit-status>
  if [[ "$2" == 0 ]]; then PASS=$((PASS + 1)); echo "  ok   $1"
  else FAIL=$((FAIL + 1)); echo "  FAIL $1"; fi
}
has()  { [[ "$1" == *"$2"* ]]; }

echo "1. happy path: typed DELETE wipes and reports counts"
run "$TOKEN" "DELETE"
check "exit 0" $([[ $RC == 0 ]]; echo $?)
check "previews keyset/books/epubs counts" $(has "$OUT" "cloud books (including deleted markers): 2"; echo $?)
check "DELETE sent with confirm phrase" $(has "$LOG" "DELETE: https://example.test/api/v1/sync/data?confirm=delete-all-synced-data"; echo $?)
check "reports rows removed" $(has "$OUT" "Rows removed: {\"synced_book\":2"; echo $?)
check "auth header carried the token" $(has "$LOG" "AUTH: ok"; echo $?)

echo "2. wrong confirmation cancels without deleting"
run "$TOKEN" "yes"
check "exit 0" $([[ $RC == 0 ]]; echo $?)
check "prints Cancelled" $(has "$OUT" "Cancelled. Nothing was deleted."; echo $?)
check "no DELETE call made" $(has "$LOG" "DELETE:" && echo 1 || echo 0)

echo "3. lowercase 'delete' is not accepted (exact match)"
run "$TOKEN" "delete"
check "no DELETE call made" $(has "$LOG" "DELETE:" && echo 1 || echo 0)

echo "4. empty token is refused before any network call"
run "" 
check "exit 2" $([[ $RC == 2 ]]; echo $?)
check "explains no token" $(has "$OUT" "no token entered"; echo $?)
check "no curl call made" $([[ -z "$LOG" ]]; echo $?)

echo "5. missing API_BASE is refused"
OUT="$(printf '%s\n' "$TOKEN" | env -u API_BASE PATH="$HERE/fixtures/bin:$PATH" STUB_LOG=/dev/null TEST_TOKEN="$TOKEN" bash "$SCRIPT" 2>&1)"; RC=$?
check "exit 2" $([[ $RC == 2 ]]; echo $?)
check "names API_BASE" $(has "$OUT" "set API_BASE"; echo $?)

echo "6. read failure stops before the wipe"
RUN_ENV=(STUB_BOOKS=500)
run "$TOKEN" "DELETE"
check "exit 1" $([[ $RC == 1 ]]; echo $?)
check "explains read failure" $(has "$OUT" "could not read your sync data"; echo $?)
check "no DELETE call made" $(has "$LOG" "DELETE:" && echo 1 || echo 0)

echo "7. wipe failure is reported with the server body"
RUN_ENV=(STUB_DELETE=500 STUB_DELETE_BODY="internal boom")
run "$TOKEN" "DELETE"
check "exit 1" $([[ $RC == 1 ]]; echo $?)
check "reports HTTP 500 and body" $(has "$OUT" "reset failed (HTTP 500)" && has "$OUT" "internal boom"; echo $?)

echo "7b. stdin closes before the confirmation: aborts, deletes nothing"
run "$TOKEN"
check "non-zero exit" $([[ $RC != 0 ]]; echo $?)
check "no DELETE call made" $(has "$LOG" "DELETE:" && echo 1 || echo 0)

echo "8. token never appears in output or in curl argv"
run "$TOKEN" "DELETE"
check "not in script output" $(has "$OUT" "$TOKEN" && echo 1 || echo 0)
check "not in curl argv log" $(has "$LOG" "$TOKEN" && echo 1 || echo 0)

echo
echo "passed: $PASS   failed: $FAIL"
[[ $FAIL == 0 ]]
