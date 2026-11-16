#!/usr/bin/env bash
# Reset ONE account's cloud library sync (ADR-014 lost-recovery-key recovery).
#
# Deletes the account's sync keyset and every encrypted cloud copy of its books,
# EPUBs and shelves. Local books on your devices are NOT touched. Irreversible.
# After it runs, open the app on the device that holds your books, tap
# Settings -> Library Sync -> Enable cloud sync, save the NEW recovery key, and sync.
#
# Usage:
#   API_BASE=<same value as the app's EXPO_PUBLIC_API_BASE_URL> ./scripts/reset-cloud-sync.sh
#
# The session token is read from a hidden prompt. It is never printed, never put
# on the command line, and is cleared from memory on exit.

set -euo pipefail

API_BASE="${API_BASE:-}"
API_BASE="${API_BASE%/}"
if [[ -z "$API_BASE" ]]; then
  echo "error: set API_BASE to the app's API base URL (the value of EXPO_PUBLIC_API_BASE_URL)." >&2
  exit 2
fi
command -v curl >/dev/null || { echo "error: curl is required." >&2; exit 2; }
command -v python3 >/dev/null || { echo "error: python3 is required." >&2; exit 2; }

TOKEN=""
cleanup() { TOKEN=""; }
trap cleanup EXIT

read -rsp "Paste your signed-in session token (input hidden): " TOKEN
echo
if [[ -z "$TOKEN" ]]; then
  echo "error: no token entered." >&2
  exit 2
fi

# Send the token via a curl config on stdin so it never appears in argv or logs.
auth_cfg() { printf 'header = "Authorization: Bearer %s"\n' "$TOKEN"; }
count_items() { python3 -c 'import sys, json; d = json.load(sys.stdin); print(len(d) if isinstance(d, list) else "n/a")'; }

echo
echo "Checking what is in the cloud for this account (read-only)..."

keyset_code=$(curl -sS -o /dev/null -w '%{http_code}' -K <(auth_cfg) "$API_BASE/sync/keyset")
echo "  keyset present: $([[ "$keyset_code" == "200" ]] && echo yes || echo "no (HTTP $keyset_code)")"

books_body=$(mktemp); epubs_body=$(mktemp)
trap 'rm -f "$books_body" "$epubs_body"; cleanup' EXIT
books_code=$(curl -sS -o "$books_body" -w '%{http_code}' -K <(auth_cfg) "$API_BASE/sync/books")
epubs_code=$(curl -sS -o "$epubs_body" -w '%{http_code}' -K <(auth_cfg) "$API_BASE/sync/epubs")
if [[ "$books_code" != "200" || "$epubs_code" != "200" ]]; then
  echo "error: could not read your sync data (HTTP $books_code / $epubs_code). Check the token and API_BASE." >&2
  exit 1
fi
echo "  cloud books (including deleted markers): $(count_items < "$books_body")"
echo "  cloud EPUBs (including deleted markers): $(count_items < "$epubs_body")"
rm -f "$books_body" "$epubs_body"

echo
echo "This permanently deletes the cloud copy of your synced library for this account."
echo "Your books on your devices are kept."
read -rp "Type DELETE to continue: " answer
if [[ "$answer" != "DELETE" ]]; then
  echo "Cancelled. Nothing was deleted."
  exit 0
fi

echo "Deleting cloud sync data..."
result_file=$(mktemp)
trap 'rm -f "$result_file"; cleanup' EXIT
code=$(curl -sS -X DELETE -o "$result_file" -w '%{http_code}' -K <(auth_cfg) \
  "$API_BASE/sync/data?confirm=delete-all-synced-data")
if [[ "$code" != "200" ]]; then
  echo "error: reset failed (HTTP $code):" >&2
  cat "$result_file" >&2
  echo >&2
  rm -f "$result_file"
  exit 1
fi
echo "Done. Rows removed: $(cat "$result_file")"
rm -f "$result_file"

echo
echo "Next: on your device, Settings -> Library Sync -> Enable cloud sync,"
echo "save the new recovery key, then Sync now."
