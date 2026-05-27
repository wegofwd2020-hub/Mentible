#!/usr/bin/env bash
# Authoritative EPUB3 validation via the official epubcheck (needs Java).
#
# The jest gate in compiler/__tests__/epub.test.ts already checks XML
# well-formedness + OCF structure with no external dependency. This script runs
# the *full* EPUB3 conformance check when epubcheck is available — wire it into
# CI once a Java/epubcheck toolchain is provisioned.
#
# Usage: scripts/epubcheck.sh <file.epub>
set -euo pipefail

EPUB="${1:-}"
if [[ -z "$EPUB" ]]; then
  echo "usage: scripts/epubcheck.sh <file.epub>" >&2
  exit 2
fi

if command -v epubcheck >/dev/null 2>&1; then
  exec epubcheck "$EPUB"
fi

if command -v java >/dev/null 2>&1 && [[ -n "${EPUBCHECK_JAR:-}" ]]; then
  exec java -jar "$EPUBCHECK_JAR" "$EPUB"
fi

cat >&2 <<'EOF'
epubcheck not found.

Install it for authoritative EPUB3 validation, then re-run:
  - npm: npm i -g epubcheck        (provides the `epubcheck` command; needs Java)
  - or:  set EPUBCHECK_JAR=/path/to/epubcheck.jar (needs `java` on PATH)

Note: the jest gate (cd compiler && npm test) validates XML well-formedness and
OCF structure WITHOUT Java, and runs in CI today. epubcheck adds full EPUB3
conformance on top.
EOF
exit 0
