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

-- 可選的 AI 加值層：每月花費上限 + 速率限制（ai.mjs 也會自動建表，這裡先列出）
CREATE TABLE IF NOT EXISTS ai_usage (
  month     TEXT PRIMARY KEY,        -- 'YYYY-MM'
  micro_usd INTEGER NOT NULL DEFAULT 0,   -- 累計花費（微美金）
  calls     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ai_rate (
  bucket TEXT PRIMARY KEY,           -- 'd:<device>:<minute>' 或 '*:<minute>'
  n      INTEGER NOT NULL DEFAULT 0,
  exp    INTEGER NOT NULL
);
