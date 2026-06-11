#!/bin/zsh
set -euo pipefail

SRC="/Users/pochuchoe/Documents/Codex/2026-06-08/ai-c-n-nh-d-n/outputs/trade-marketing-tools-dark-terrazzo"
DST="/Users/pochuchoe/Documents/GitHub/colentrade-marketing-tools"

echo "Syncing Trade Marketing Tools to GitHub repo..."
echo "Source: $SRC"
echo "Repo:   $DST"
echo ""

if [ ! -d "$SRC" ]; then
  echo "Source folder not found."
  read -k 1 "?Press any key to close..."
  exit 1
fi

if [ ! -d "$DST/.git" ]; then
  echo "GitHub repo not found: $DST"
  read -k 1 "?Press any key to close..."
  exit 1
fi

rsync -av \
  --exclude='.git' \
  --exclude='.DS_Store' \
  "$SRC/" "$DST/"

cd "$DST"

echo ""
echo "Git status:"
git status --short

if git diff --quiet && git diff --cached --quiet; then
  echo ""
  echo "No changes to commit."
  read -k 1 "?Press any key to close..."
  exit 0
fi

git add \
  index.html \
  vercel.json \
  package.json \
  README.md \
  dsm-apps-script-api.gs \
  api \
  assets \
  dsm \
  image-tools

git commit -m "Update DSM access and terrazzo UI"
git push origin main

echo ""
echo "Done. GitHub has been updated."
echo "Vercel should redeploy automatically from main."
read -k 1 "?Press any key to close..."
