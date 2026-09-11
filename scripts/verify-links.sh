#!/bin/bash
# verify-links.sh — every "Open" link on the dashboard, plus the dashboard's own
# files, must answer 200. Run after a deploy.
set -uo pipefail
cd "$(dirname "$0")/.."

DASH="${1:-https://apps.precogsoftwareservices.com}"
fail=0

check() { # url expected-status label
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1")
  if [ "$code" = "$2" ]; then printf '  %-3s %s\n' "$code" "$3"
  else printf '  %-3s %s  <-- expected %s\n' "$code" "$3" "$2"; fail=1; fi
}

echo "dashboard:"
check "$DASH/" 200 "$DASH/"
check "$DASH/app.js" 200 "$DASH/app.js"
check "$DASH/apps.json" 200 "$DASH/apps.json"

# the page must really be the list build, not a cached card grid
body=$(curl -s --max-time 20 "$DASH/")
echo "$body" | grep -q 'id="list"' || { echo '  MISSING <main id="list"> on the live page'; fail=1; }
echo "$body" | grep -q 'class="card"' && { echo '  card markup still on the live page'; fail=1; }
curl -s --max-time 20 "$DASH/app.js" | grep -q 'Dashboard' || { echo '  app.js served without the Dashboard bundle'; fail=1; }

echo "Open links:"
n=0
while IFS=$'\t' read -r name url; do
  n=$((n+1))
  check "$url" 200 "$name — $url"
done < <(python3 -c 'import json;[print(a["name"]+"\t"+a["url"]) for a in json.load(open("apps.json"))]')

echo "$n Open links checked"
[ "$n" -eq 11 ] || { echo "  expected 11 links, found $n"; fail=1; }
[ "$fail" -eq 0 ] && echo "ALL GREEN" || echo "FAILURES ABOVE"
exit $fail
