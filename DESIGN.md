# 若者チャレンジ支援 MCPサーバー 設計書（雪越市モデル）

台の案件: `youth-challenge-joetsu`（What is your LIFE? とは別プロジェクト）

## 1. 方針
- 舞台は**架空の「雪越市（ゆきごえし）」**。地名・施設・人物はすべて架空（[data/region.json](data/region.json)）。
- 人口規模・高齢化・若者の転出・豪雪・中心市街地の空き店舗・中山間地の担い手不足など、**設定の土台は新潟県上越市を参考**にしている（応募物には実在の地名を出さない）。
- データはダミー。本番は **Cloudflare D1**。ローカルでも D1（`wrangler dev`）で動かす。
- 応募デモではログインを作らず、**デモ用に「誰として使うか」を切り替える**。本番はGoogleログイン（OAuth）。

## 2. 利用者の区別
| | 若者（youth） | 大人（adult: mentor / professional / provider） |
|---|---|---|
| 使えるツール | 背中押し・大人/仲間/場所/補助金を探す・見積もり・相談申込 | 自分のプロフィール登録・更新、届いた相談を見る・受ける/断る |
| 見える情報 | 大人の公開プロフィール（連絡先は見せない） | 相談してきた若者のニックネーム・学年・やりたいこと |
| 登録 | ニックネーム・学年・地区・興味・やりたいこと等。未成年は保護者同意 | 経歴・応援する理由・得意分野・関わり方等。窓口の確認（verified）後に公開 |

連絡先は直接やりとりせず、`consultations`（相談）を通してつなぐ。

## 3. 役割分担：判断するのはGemini、MCPは情報を出すだけ
| | 担当 |
|---|---|
| **Gemini（接続先AI）** | 若者の話を聞く・背中を押す・誰が合うかを選ぶ・理由を説明する・最初の一歩を提案する |
| **MCPサーバー** | 頼まれた条件でデータを返す（点数付け・並び替え・推測はしない） |

サーバーに残すのは安全のためのルールだけ：保護者同意のない未成年は相談不可、窓口未確認の大人には相談不可、連絡先や移動手段などの個人情報は出さない、立場ごとにツールを分ける。

## 4. MCPツール
共通: `whoami`（自分のプロフィール全項目）, `list_demo_users`, `get_region`, `register_profile`（ゲスト）, `update_profile`
情報: `find_adults`, `find_peers`（若者）, `find_resources`, `find_grants`, `find_cases`
判断の材料: `get_encouragement_guide`（背中押しガイド）, `find_vendors`（架空の業者16社と価格表。同じ品目を複数社で比べ、頼む会社まで提案できる）

## 4-2. 背中押し（今回の最重要機能）
ガイドは [data/encouragement.json](data/encouragement.json)（D1 `encouragement`、31件）。
| 種類 | 中身 |
|---|---|
| principle | 守る原則8つ（全肯定・具体的にほめる・一歩は1つ・失敗談・本人が決める・NGワード・根拠ある数字・一人にしない） |
| flow | 会話の流れ8ステップ（聞く→ほめる→理由→不安→材料→選ぶ→一歩→次の約束） |
| grade_tone | 小・中・高・大/専門ごとの話し方 |
| stage | 思いつき・計画中・停滞・本番直前・終了後 |
| worry | 不安11種（お金・親/学校・集客・安全・自信・手続き・食品・両立・移動/雪・大人が怖い・失敗が怖い）と、使うツール |
| safety | AIだけで抱えない場面、未成年の個人情報 |
| adult | 大人が返事を書く・断るときの助言 |

Geminiへの届け方は3重：①接続時の説明文に原則の要約 ②MCPプロンプト `youth_supporter`（学年を渡すとその話し方だけ入る）/ `adult_reply_helper` ③ツール `get_encouragement_guide`。
相談: `request_consultation`（若者）, `list_my_consultations`, `respond_consultation`（大人）

想定の流れ（Gemini側）: `whoami` で若者の不安・希望・空き時間を把握 → `find_adults` / `find_cases` で候補と先輩事例を集める → Geminiが比べて「この人がいいと思う理由」と失敗談を添えて提案 → 本人がOKなら `request_consultation`。

## 5. データ（D1）
テーブル定義は [schema.sql](schema.sql)。
`users` / `adult_profiles` / `youth_profiles` / `resources` / `grants` / `cases` / `consultations`

ダミーデータの元は `data/*.json`（大人20・若者20・リソース20・補助金8・事例10）。
`node scripts/build-seed.mjs` で `seed.sql` を作り、D1に流し込む。

## 6. ローカルで動かす
```
npm install
npm run db:local     # テーブル作成＋ダミーデータ投入（ローカルD1）
npm run dev          # http://localhost:8787/mcp
npm test             # 主要ツールの動作確認（dev を起動した状態で）
```
デモの利用者切り替え: `/mcp?as=y001`（若者そら）、`/mcp?as=a001`（大人 春川さん）、`?as` なしはゲスト（登録のみ）。

## 7. ディレクトリ
```
joetsu-mcp/
  DESIGN.md  schema.sql  seed.sql
  data/*.json           # ダミーデータの元
  scripts/build-seed.mjs
  src/                  # これから: Worker + MCPツール
```
