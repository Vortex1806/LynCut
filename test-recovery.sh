#!/usr/bin/env bash
# Phase 6 verification: consumer group, flusher, crash recovery.
# Requires: API on :3000, docker compose up, jq. The worker is started/killed by this script.
set -uo pipefail

API=http://localhost:3000
EMAIL=recovery-test@example.com
PASS=supersecret123
STREAM=link:visits
GROUP=analytics-workers
HASH=link:visit-counts

r()  { docker compose exec -T redis redis-cli "$@"; }
pend() { r XPENDING "$STREAM" "$GROUP" | head -1 | tr -d '\r'; }
hcount() { r HGET "$HASH" "$1" | tr -d '\r'; }
db() { curl -s "$API/api/links" -H "Authorization: Bearer $TOKEN" \
       | jq -r --arg c "$1" '.items[] | select(.shortCode==$c) | .visitCount'; }
start_worker() { npm run dev:worker >/tmp/lyncut-worker.log 2>&1 & sleep 4; }
kill_worker()  { pkill -9 -f "analytics.worker" 2>/dev/null; sleep 1; }
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  \033[32mPASS\033[0m %s\n' "$*"; }
bad() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAILED=1; }
FAILED=0

say "SETUP"
curl -s -X POST "$API/api/auth/signup" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Recovery\",\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" >/dev/null
TOKEN=$(curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | jq -r .accessToken)
[ "$TOKEN" = "null" ] && { echo "login failed - is the API running?"; exit 1; }

CODE=$(curl -s -X POST "$API/api/links" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"targetUrl":"https://example.com/recovery-test"}' | jq -r .shortCode)
echo "  token ok, code=$CODE"

kill_worker
r DEL "$HASH" >/dev/null

say "TEST 1  worker consumes and flushes to Postgres"
start_worker
for i in $(seq 1 5); do curl -s -o /dev/null "$API/$CODE"; done
sleep 14
[ "$(db "$CODE")" = "5" ] && ok "visitCount=5 in Postgres" || bad "visitCount=$(db "$CODE"), expected 5"
[ -z "$(hcount "$CODE")" ] && ok "counts hash drained" || bad "hash still holds $(hcount "$CODE")"
[ "$(pend)" = "0" ] && ok "XPENDING=0" || bad "XPENDING=$(pend), expected 0"

say "TEST 2  counts ACCUMULATE (+= not =)"
for i in $(seq 1 5); do curl -s -o /dev/null "$API/$CODE"; done
sleep 14
[ "$(db "$CODE")" = "10" ] && ok "visitCount=10" || bad "visitCount=$(db "$CODE"), expected 10 (SQL may be '=' not '+=')"

say "TEST 3  events queued while the worker is DOWN are not lost"
kill_worker
for i in $(seq 1 3); do curl -s -o /dev/null "$API/$CODE"; done
BEFORE=$(db "$CODE")
echo "  worker down, 3 redirects fired, visitCount still $BEFORE"
start_worker
sleep 14
[ "$(db "$CODE")" = "13" ] && ok "visitCount=13 - queued events consumed" || bad "visitCount=$(db "$CODE"), expected 13"

say "TEST 4  restart does NOT replay the stream (the old repo's bug)"
kill_worker; start_worker
sleep 14
[ "$(db "$CODE")" = "13" ] && ok "visitCount still 13 - no double count" || bad "visitCount=$(db "$CODE"), expected 13 - STREAM REPLAYED"

say "TEST 5  kill -9 mid-batch leaves pending, restart recovers it"
kill_worker
for i in $(seq 1 20); do curl -s -o /dev/null "$API/$CODE" & done; wait
start_worker & sleep 1; kill_worker            # kill it while it is consuming
P=$(pend)
echo "  XPENDING after kill -9: $P"
start_worker
sleep 14
AFTER=$(db "$CODE")
[ "$(pend)" = "0" ] && ok "XPENDING back to 0 - recovery ran" || bad "XPENDING=$(pend), messages stranded"
[ "$AFTER" -ge 33 ] && ok "visitCount=$AFTER (>=33, at-least-once allows over-count)" \
                    || bad "visitCount=$AFTER, expected >=33 - events LOST"

say "RESULT"
kill_worker
[ "$FAILED" = "0" ] && printf '  \033[32mall checks passed\033[0m\n' || printf '  \033[31msome checks failed\033[0m\n'
echo "  worker log: /tmp/lyncut-worker.log"
exit "$FAILED"
