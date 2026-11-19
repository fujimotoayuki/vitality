-- 雪越市 若者チャレンジ支援 D1 スキーマ
-- 配列・複数値は JSON 文字列で保存（D1/SQLite の json_each で検索可能）

DROP TABLE IF EXISTS consultations;
DROP TABLE IF EXISTS encouragement;
DROP TABLE IF EXISTS cost_items;
DROP TABLE IF EXISTS vendor_prices;
DROP TABLE IF EXISTS vendors;
DROP TABLE IF EXISTS cases;
DROP TABLE IF EXISTS grants;
DROP TABLE IF EXISTS resources;
DROP TABLE IF EXISTS youth_profiles;
DROP TABLE IF EXISTS adult_profiles;
DROP TABLE IF EXISTS users;

-- 利用者（若者・大人の共通部分）。本番はGoogleログイン(OAuth)の sub と紐づける
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  role          TEXT NOT NULL CHECK (role IN ('youth','adult','staff')),
  display_name  TEXT NOT NULL,          -- 若者はニックネーム
  auth_subject  TEXT UNIQUE,            -- OAuthのユーザーID（デモでは NULL）
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','suspended')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 大人（メンター・専門職・場所や機材の提供者）。マッチングの肝
CREATE TABLE adult_profiles (
  user_id            TEXT PRIMARY KEY REFERENCES users(id),
  kind               TEXT NOT NULL CHECK (kind IN ('mentor','professional','provider')),
  age_range          TEXT,              -- 30代 など
  occupation         TEXT NOT NULL,
  district           TEXT NOT NULL,
  life_story         TEXT,              -- 経歴・地元との関わり
  why_support        TEXT,              -- 若者を応援する理由
  categories         TEXT NOT NULL,     -- JSON: event/startup/volunteer/art/tech/food
  skills             TEXT NOT NULL,     -- JSON
  failures_to_share  TEXT,              -- 話せる失敗談
  personality        TEXT,              -- JSON: 性格タグ
  communication      TEXT,              -- 話し方・関わり方のスタイル
  support_modes      TEXT NOT NULL,     -- JSON: chat/meet/onsite/review/introduce/lend
  frequency          TEXT,              -- 月1回 など
  available_times    TEXT,              -- JSON: 平日夜/土日 など
  target_grades      TEXT NOT NULL,     -- JSON: 小/中/高/大/専門
  not_good_at        TEXT,              -- 苦手・対応できないこと
  verified           INTEGER NOT NULL DEFAULT 0  -- 窓口の確認済み
);

-- 若者
CREATE TABLE youth_profiles (
  user_id           TEXT PRIMARY KEY REFERENCES users(id),
  grade             TEXT NOT NULL CHECK (grade IN ('小','中','高','大','専門')),
  school_year       TEXT,                -- 高校2年 など（学校名は持たない）
  district          TEXT NOT NULL,
  interests         TEXT NOT NULL,       -- JSON
  can_do            TEXT,                -- JSON
  current_idea      TEXT,                -- いまやってみたいこと
  idea_category     TEXT,
  worries           TEXT,                -- JSON: 不安・ハードル
  personality       TEXT,                -- JSON
  wants_from_adult  TEXT,                -- 大人に求める関わり方
  wants_peer        TEXT,                -- 仲間に求めること
  available_times   TEXT,                -- JSON
  mobility          TEXT,                -- 移動手段（自転車・バス・送迎あり等）
  guardian_consent  INTEGER NOT NULL DEFAULT 0, -- 未成年の保護者同意
  open_to_peers     INTEGER NOT NULL DEFAULT 1  -- 仲間検索に表示してよいか
);

CREATE TABLE resources (
  id                 TEXT PRIMARY KEY,
  provider_user_id   TEXT REFERENCES users(id),
  type               TEXT NOT NULL CHECK (type IN ('space','shop','equipment','name_lending','insurance','template','transport')),
  name               TEXT NOT NULL,
  description        TEXT,
  district           TEXT,
  cost               INTEGER NOT NULL DEFAULT 0,
  cost_note          TEXT,
  student_conditions TEXT,
  how_to_book        TEXT,
  winter_ok          INTEGER NOT NULL DEFAULT 1,
  tags               TEXT                -- JSON
);

CREATE TABLE grants (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  provider       TEXT,
  max_amount     INTEGER,
  target_grades  TEXT,                   -- JSON
  categories     TEXT,                   -- JSON
  deadline       TEXT,
  conditions     TEXT,
  tags           TEXT
);

CREATE TABLE cases (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  grade         TEXT,
  category      TEXT,
  scale         TEXT CHECK (scale IN ('小','中','大')),
  district      TEXT,
  summary       TEXT,
  budget_total  INTEGER,
  budget_items  TEXT,                    -- JSON [{item,cost}]
  prep_weeks    INTEGER,
  first_steps   TEXT,                    -- JSON
  helpers       TEXT,                    -- JSON: user/resource/grant id
  learned       TEXT
);

-- 相談の申し込み（若者→大人）。連絡先は直接渡さず、ここを通してつなぐ
CREATE TABLE consultations (
  id             TEXT PRIMARY KEY,
  youth_user_id  TEXT NOT NULL REFERENCES users(id),
  adult_user_id  TEXT NOT NULL REFERENCES users(id),
  message        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','accepted','declined','done')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 背中押しのガイド（Geminiが参照する材料。文章を作るのはGemini）
CREATE TABLE encouragement (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('principle','flow','grade_tone','stage','worry','safety','adult')),
  audience    TEXT NOT NULL CHECK (audience IN ('youth','adult')), -- AIが話しかける相手
  stage       TEXT,                     -- all/idea/planning/stuck/just_before/after
  grades      TEXT,                     -- JSON: 空=全学年
  worry_tags  TEXT,                     -- JSON: この不安に当てはまる言葉
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  steps       TEXT,                     -- JSON: 手順
  ok_examples TEXT,                     -- JSON: 良い声かけ
  ng_examples TEXT,                     -- JSON: 使わない声かけ
  refer       TEXT                      -- JSON: 一緒に使うツール
);

-- 業者（架空）。費用の相場と、頼める会社の提案に使う
CREATE TABLE vendors (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL,       -- 印刷/イベント機材/バス・送迎/飲食・ケータリング/保険/包装・資材
  district         TEXT,
  description      TEXT,
  strengths        TEXT,                -- JSON
  student_discount TEXT,
  lead_days        INTEGER,             -- 何日前までに頼むか
  min_order        TEXT,
  contact_via      TEXT
);

-- 業者ごとの価格。item_key が同じものは会社をまたいで比べられる
CREATE TABLE vendor_prices (
  id         TEXT PRIMARY KEY,
  vendor_id  TEXT NOT NULL REFERENCES vendors(id),
  item_key   TEXT NOT NULL,
  item       TEXT NOT NULL,
  unit       TEXT NOT NULL,
  price      INTEGER NOT NULL,
  note       TEXT
);
CREATE INDEX idx_price_item ON vendor_prices(item_key);

CREATE INDEX idx_adult_district ON adult_profiles(district);
CREATE INDEX idx_youth_district ON youth_profiles(district);
CREATE INDEX idx_consult_adult ON consultations(adult_user_id, status);
