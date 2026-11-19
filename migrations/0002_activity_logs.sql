-- 本人が「記録したい」と言ったことの記録（振り返り・成長記録。本人しか見られない）
CREATE TABLE IF NOT EXISTS activity_logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  log_date    TEXT NOT NULL,             -- 出来事の日付 YYYY-MM-DD（省略時は今日）
  kind        TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('idea','progress','feeling','learned','plan','note')),
  content     TEXT NOT NULL,
  tags        TEXT,                      -- JSON
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_logs_user ON activity_logs(user_id, log_date);
