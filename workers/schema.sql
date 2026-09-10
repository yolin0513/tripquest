-- TripQuest 同步伺服器 D1 schema
-- 執行：wrangler d1 execute tripquest --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS groups (
  id         TEXT PRIMARY KEY,
  secret     TEXT NOT NULL,          -- 128-bit 邀請祕鑰（hex）
  seq        INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS records (
  group_id   TEXT NOT NULL,
  id         TEXT NOT NULL,
  seq        INTEGER NOT NULL,       -- 伺服器指派的單調序號（同步游標）
  type       TEXT,
  updated_at INTEGER,
  device_id  TEXT,
  json       TEXT NOT NULL,
  PRIMARY KEY (group_id, id)
);

CREATE INDEX IF NOT EXISTS idx_records_group_seq ON records (group_id, seq);

-- 限流計數（v1.65）。固定視窗：k = 用途:對象、win = 視窗編號、n = 這個視窗內的次數。
-- 用 D1 而不是 Workers 的 Rate Limiting 綁定 —— 實測那個綁定在這個方案上不會計數
-- （40 次以上呼叫、額度 5/10 秒，永遠回 success:true）。
CREATE TABLE IF NOT EXISTS rl (
  k   TEXT PRIMARY KEY,
  n   INTEGER NOT NULL,
  win INTEGER NOT NULL
);
