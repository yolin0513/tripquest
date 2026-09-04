#!/usr/bin/env bash
# TripQuest —— Cloudflare 一鍵部署（回到電腦前跑這一支）
#
#   cd D:/Claude/App/TripQuest
#   bash scripts/publish-cloud.sh
#
# 過程中會開一次瀏覽器，請按「Allow」授權 wrangler。其餘全自動。
# 前提：已註冊 Cloudflare、已在後台啟用 R2（綁好卡）。

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
TOML="workers/wrangler.toml"
BUCKET="tripquest-photos"
DB="tripquest"

wr() { npx --yes wrangler "$@"; }

echo "==> 1/6 wrangler 登入（瀏覽器會跳出，請按 Allow）"
if wr whoami 2>/dev/null | grep -qi "You are logged in"; then
  echo "    已登入，略過"
else
  wr login
fi
wr whoami | sed -n '1,4p' || true

echo "==> 2/6 建立 D1 資料庫 $DB"
if wr d1 list 2>/dev/null | grep -q "\b$DB\b"; then
  echo "    已存在"
  DBID=$(wr d1 info "$DB" 2>/dev/null | grep -iE "database_id|uuid" | grep -oE "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" | head -1)
else
  OUT=$(wr d1 create "$DB")
  echo "$OUT"
  DBID=$(echo "$OUT" | grep -oE "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" | head -1)
fi
if [ -z "${DBID:-}" ]; then
  echo "!! 拿不到 database_id，請手動把它填進 $TOML 的 database_id 欄位後重跑" >&2
  exit 1
fi
echo "    database_id = $DBID"

echo "==> 3/6 寫入 $TOML"
# 只替換 database_id 那一行，其他不動
sed -i.bak -E "s|^database_id = .*|database_id = \"$DBID\"|" "$TOML"
rm -f "$TOML.bak"
grep "database_id" "$TOML"

echo "==> 4/6 建立資料表（schema.sql）"
wr d1 execute "$DB" --remote --file=workers/schema.sql --yes

echo "==> 5/6 建立 R2 bucket $BUCKET"
if wr r2 bucket list 2>/dev/null | grep -q "$BUCKET"; then
  echo "    已存在"
else
  wr r2 bucket create "$BUCKET"
fi

echo "==> 6/6 部署 Worker"
DEPLOY=$(cd workers && wr deploy)
echo "$DEPLOY"
URL=$(echo "$DEPLOY" | grep -oE "https://[a-zA-Z0-9.-]+\.workers\.dev" | head -1)

echo
echo "========================================================"
if [ -n "${URL:-}" ]; then
  echo " 完成！Worker 網址："
  echo "   $URL"
  echo
  echo " 驗證："
  echo "   curl $URL/health"
  echo "   node scripts/synctest.mjs --url $URL"
  echo
  echo " 然後在手機 App：設定 → 多人同步 → 設定同步伺服器"
  echo "   選「Cloudflare」，貼上：$URL"
else
  echo " 部署完成，但沒抓到 workers.dev 網址，請看上面 deploy 輸出。"
fi
echo "========================================================"
