#!/usr/bin/env bash
# scripts/lint.sh — run lint in every workspace that defines a `lint` script.
# Today only @maestro/renderer has ESLint configured; this script is the
# single entry point so adding lint to a new package is automatic.
# Usage: npm run lint
set -euo pipefail

root="$PWD"
ran=0
for pkg_json in "$root"/packages/*/package.json; do
  pkg=$(basename "$(dirname "$pkg_json")")
  if node -e "const p=require('$pkg_json'); if(!p.scripts||!p.scripts.lint) process.exit(1);"; then
    echo "── lint: ${pkg} ──"
    ( cd "$root/packages/$pkg" && npm run -s lint )
    ran=$((ran + 1))
  fi
done

if [ "$ran" -eq 0 ]; then
  echo "── no workspace defines a 'lint' script (skipping) ──"
fi
echo "── lint done (${ran} package(s)) ──"
