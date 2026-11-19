// MCPツールの定義と処理
// 方針: サーバーは「頼まれた条件のデータを返すだけ」。誰が合うか・どう励ますかの判断は接続先のAI（Gemini）が行う。
// サーバー側に残すのは、条件での絞り込みと、安全のためのルール（保護者同意・窓口確認・連絡先を出さない）だけ。
export interface Env { DB: D1Database; DEMO_MODE: string }
export type Role = "youth" | "adult" | "staff" | "guest";
export type Viewer = { id: string | null; role: Role; name: string; onboarding: boolean }; // onboarding = プロフィール未登録

const CATEGORIES = ["event", "startup", "volunteer", "art", "tech", "food"] as const;
const GRADES = ["小", "中", "高", "大", "専門"];
const DISTRICTS = ["honjo", "shiomi", "shineki", "gakuen", "yamasato", "hamasato"];

// ---------- 小さな道具 ----------
const parse = <T = any>(v: unknown, fallback: T): T => { if (typeof v !== "string") return (v as T) ?? fallback; try { return JSON.parse(v); } catch { return fallback; } };
const arr = (v: unknown): string[] => parse<string[]>(v, []) ?? [];
const textOf = (...vs: unknown[]) => vs.map((v) => (Array.isArray(v) ? v.join(" ") : typeof v === "string" ? v : "")).join(" ");
const kw = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s、,，]+/) : []).filter(Boolean);
const anyIn = (text: string, words: string[]) => words.some((w) => text.includes(w));
const need = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg); };
// JSON文字列の列を配列に戻す
const expand = (row: Record<string, any>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "string" && /^[\[{]/.test(v) ? parse(v, v) : v]));

// ---------- 地域 ----------
const REGION = {
  city: "雪越市（ゆきごえし・架空）",
  population: "約18万人、高齢化率 約34%",
  issues: ["高校卒業後の若者の転出", "中心市街地の空き店舗", "中山間地の高齢化と担い手不足", "冬は豪雪で屋外活動・移動が難しい", "車がないと移動しづらい"],
  districts: {
    honjo: "本城：城下町。雪屋根通り商店街・城跡公園。空き店舗が多い",
    shiomi: "汐見：港町。工場と古い町並み、海岸。港のNPOが活発",
    shineki: "新駅前：新幹線駅周辺。新しい住宅と商業施設",
    gakuen: "学園台：大学と高校が集まる学生街",
    yamasato: "山里：中山間地。棚田・古民家・スキー場。高齢化率50%超",
    hamasato: "浜里：海沿いの農村・漁村。直売所と小さな漁港",
  },
  categories: { event: "イベント", startup: "起業・販売", volunteer: "ボランティア", art: "創作・音楽・映像", tech: "IT・ものづくり", food: "食・農・漁" },
};

// ---------- 自分 ----------
async function whoami(viewer: Viewer, env: Env) {
  if (!viewer.id) return { role: "guest", note: "デモでは /mcp?as=<id> で利用者を選びます。list_demo_users で一覧、register_profile で新規登録" };
  const table = viewer.role === "youth" ? "youth_profiles" : "adult_profiles";
  if (viewer.onboarding) return {
    id: viewer.id, role: viewer.role, first_time: true, profile: null,
    note: "初めての利用者です。プロフィールはまだ空です。会話の中で少しずつ聞き、本人に確認してから setup_profile で登録してください",
    required: viewer.role === "youth" ? ["display_name（ニックネーム）", "grade", "district", "interests"] : ["display_name", "district", "kind", "occupation", "categories", "skills", "support_modes", "target_grades"],
  };
  const p = await env.DB.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).bind(viewer.id).first<any>();
  return { id: viewer.id, role: viewer.role, name: viewer.name, first_time: false, profile: p ? expand(p) : null };
}

async function listDemoUsers(env: Env) {
  const y = (await env.DB.prepare("SELECT u.id, u.display_name, y.school_year, y.current_idea FROM users u JOIN youth_profiles y ON y.user_id=u.id ORDER BY u.id").all()).results;
  const a = (await env.DB.prepare("SELECT u.id, u.display_name, p.occupation FROM users u JOIN adult_profiles p ON p.user_id=u.id ORDER BY u.id").all()).results;
  const blank = (await env.DB.prepare(
    "SELECT u.id, u.role FROM users u WHERE u.role IN ('youth','adult') AND NOT EXISTS (SELECT 1 FROM youth_profiles WHERE user_id=u.id) AND NOT EXISTS (SELECT 1 FROM adult_profiles WHERE user_id=u.id) ORDER BY u.id"
  ).all()).results;
  return { how_to: "MCPのURLを /mcp?as=<id> にして接続し直す", first_time_accounts: blank, youth: y, adults: a };
}

// ---------- 大人 ----------
// 条件に合う大人のプロフィールをそのまま返す（並び替え・点数付けはしない）
async function findAdults(a: any, env: Env) {
  let rows = (await env.DB.prepare(
    "SELECT u.id, u.display_name AS name, p.* FROM users u JOIN adult_profiles p ON p.user_id = u.id WHERE u.status = 'active' ORDER BY u.id"
  ).all<any>()).results.map(expand);
  if (a.kind) rows = rows.filter((r) => r.kind === a.kind);
  if (a.category) rows = rows.filter((r) => r.categories.includes(a.category));
  if (a.grade) rows = rows.filter((r) => r.target_grades.includes(a.grade));
  if (a.district) rows = rows.filter((r) => r.district === a.district);
  const keys = kw(a.keywords);
  if (keys.length) rows = rows.filter((r) => anyIn(textOf(r.occupation, r.skills, r.life_story, r.why_support, r.failures_to_share), keys));
  return {
    count: rows.length,
    adults: rows.map(({ user_id, ...r }) => ({ ...r, verified: !!r.verified })),
    note: "連絡先は含みません。相談は request_consultation から。verified=false の人には相談を送れません",
  };
}

// ---------- 仲間 ----------
async function findPeers(a: any, viewer: Viewer, env: Env) {
  let rows = (await env.DB.prepare(
    "SELECT u.id, u.display_name AS nickname, y.grade, y.school_year, y.district, y.interests, y.can_do, y.current_idea, y.idea_category, y.personality, y.wants_peer, y.available_times FROM users u JOIN youth_profiles y ON y.user_id = u.id WHERE u.status='active' AND y.open_to_peers = 1 AND u.id != ? ORDER BY u.id"
  ).bind(viewer.id ?? "").all<any>()).results.map(expand);
  if (a.grade) rows = rows.filter((r) => r.grade === a.grade);
  if (a.district) rows = rows.filter((r) => r.district === a.district);
  if (a.category) rows = rows.filter((r) => r.idea_category === a.category);
  const keys = kw(a.keywords);
  if (keys.length) rows = rows.filter((r) => anyIn(textOf(r.interests, r.can_do, r.current_idea, r.wants_peer), keys));
  return { count: rows.length, peers: rows, note: "仲間検索に公開OKの人だけ。移動手段・保護者同意などの個人情報は含みません" };
}

// ---------- リソース・補助金・事例 ----------
async function findResources(a: any, env: Env) {
  let sql = "SELECT * FROM resources WHERE 1=1"; const b: unknown[] = [];
  if (a.type) { sql += " AND type = ?"; b.push(a.type); }
  if (a.district) { sql += " AND (district = ? OR district = 'all')"; b.push(a.district); }
  if (a.max_cost !== undefined) { sql += " AND cost <= ?"; b.push(a.max_cost); }
  if (a.winter) sql += " AND winter_ok = 1";
  let rows = (await env.DB.prepare(sql + " ORDER BY id").bind(...b).all<any>()).results.map(expand);
  const keys = kw(a.keywords);
  if (keys.length) rows = rows.filter((r) => anyIn(textOf(r.name, r.description, r.tags), keys));
  return { count: rows.length, resources: rows.map((r) => ({ ...r, winter_ok: !!r.winter_ok })) };
}

async function findGrants(a: any, env: Env) {
  let rows = (await env.DB.prepare("SELECT * FROM grants ORDER BY id").all<any>()).results.map(expand);
  if (a.grade) rows = rows.filter((g) => g.target_grades.includes(a.grade));
  if (a.category) rows = rows.filter((g) => g.categories.includes(a.category));
  if (a.min_amount) rows = rows.filter((g) => g.max_amount >= a.min_amount);
  return { count: rows.length, grants: rows };
}

async function findCases(a: any, env: Env) {
  let rows = (await env.DB.prepare("SELECT * FROM cases ORDER BY id").all<any>()).results.map(expand);
  if (a.category) rows = rows.filter((c) => c.category === a.category);
  if (a.grade) rows = rows.filter((c) => c.grade === a.grade);
  if (a.scale) rows = rows.filter((c) => c.scale === a.scale);
  if (a.district) rows = rows.filter((c) => c.district === a.district);
  const keys = kw(a.keywords);
  if (keys.length) rows = rows.filter((c) => anyIn(textOf(c.title, c.summary, c.learned), keys));
  return { count: rows.length, cases: rows, note: "budget_items（費用の内訳）・prep_weeks（準備期間）・first_steps（最初にやったこと）・learned（学び）を含みます" };
}

// ---------- 背中押しガイド・費用単価 ----------
export async function getEncouragementGuide(a: any, env: Env) {
  let rows = (await env.DB.prepare("SELECT * FROM encouragement ORDER BY id").all<any>()).results.map(expand);
  rows = rows.filter((r) => r.audience === (a.audience ?? "youth"));
  if (a.kind) rows = rows.filter((r) => r.kind === a.kind);
  if (a.stage) rows = rows.filter((r) => r.stage === "all" || r.stage === a.stage);
  if (a.grade) rows = rows.filter((r) => !r.grades?.length || r.grades.includes(a.grade));
  const worries = kw(a.worries);
  if (worries.length) rows = rows.filter((r) => r.kind !== "worry" || worries.some((w) => r.worry_tags.some((t: string) => w.includes(t) || t.includes(w))));
  return { count: rows.length, guide: rows, note: "principle=守る原則 / flow=会話の流れ / grade_tone=学年ごとの話し方 / stage=段階ごと / worry=不安ごとの安心材料 / safety=AIだけで抱えない場面 / adult=大人向け。声かけの文章はこれを参考にAIが作る" };
}

// 業者と価格（架空）。同じ item_key は会社をまたいで比べられる
async function findVendors(a: any, env: Env) {
  const vendors = (await env.DB.prepare("SELECT * FROM vendors ORDER BY id").all<any>()).results.map(expand);
  const prices = (await env.DB.prepare("SELECT * FROM vendor_prices ORDER BY item_key, vendor_id").all<any>()).results;
  const keys = kw(a.keywords);
  let list: any[] = vendors.map((v) => ({ ...v, prices: prices.filter((p) => p.vendor_id === v.id).map(({ vendor_id, ...p }) => p) }));
  if (a.type) list = list.filter((v) => v.type === a.type);
  if (a.district) list = list.filter((v) => v.district === "all" || v.district === a.district);
  if (a.item_key) list = list.map((v) => ({ ...v, prices: v.prices.filter((p: any) => p.item_key === a.item_key) })).filter((v) => v.prices.length);
  if (keys.length) list = list.map((v) => ({ ...v, prices: v.prices.filter((p: any) => anyIn(textOf(p.item, p.note), keys)) })).filter((v) => v.prices.length || anyIn(textOf(v.name, v.description), keys));
  const itemKeys = [...new Map(prices.map((p) => [p.item_key, `${p.item}（${p.unit}）`])).entries()].map(([k, v]) => ({ item_key: k, item: v }));
  return { count: list.length, vendors: list, item_keys: itemKeys, note: "すべて架空の会社。価格は税込の目安。学割・納期（lead_days）・最低注文数も見て比べる" };
}

// ---------- 相談（安全のためのルールはサーバーで守る） ----------
async function youthProfile(env: Env, id: string | null) {
  if (!id) return null;
  return env.DB.prepare("SELECT * FROM youth_profiles WHERE user_id = ?").bind(id).first<any>();
}

async function requestConsultation(a: any, viewer: Viewer, env: Env) {
  need(a.adult_id && a.message, "adult_id と message が必要です");
  const adult = await env.DB.prepare("SELECT u.display_name, p.verified FROM users u JOIN adult_profiles p ON p.user_id = u.id WHERE u.id = ? AND u.status='active'").bind(a.adult_id).first<any>();
  need(adult, "その大人は見つかりません");
  need(adult.verified, "この方はまだ窓口の確認中のため、相談を受け付けていません");
  const me = await youthProfile(env, viewer.id);
  if (me && ["小", "中", "高"].includes(me.grade) && !me.guardian_consent)
    throw new Error("未成年の相談には保護者の同意が必要です。保護者説明シート（resources: r013）を使ってください");
  const id = "q" + crypto.randomUUID().slice(0, 8);
  await env.DB.prepare("INSERT INTO consultations (id, youth_user_id, adult_user_id, message) VALUES (?,?,?,?)").bind(id, viewer.id, a.adult_id, a.message).run();
  return { id, to: adult.display_name, status: "requested", note: "相手が受けると、窓口から連絡方法が届きます（デモでは状態だけ変わります）" };
}

async function listMyConsultations(viewer: Viewer, env: Env) {
  if (viewer.role === "adult") {
    return (await env.DB.prepare(
      "SELECT c.id, c.message, c.status, c.created_at, u.display_name AS nickname, y.grade, y.school_year, y.district, y.current_idea, y.worries FROM consultations c JOIN users u ON u.id = c.youth_user_id JOIN youth_profiles y ON y.user_id = c.youth_user_id WHERE c.adult_user_id = ? ORDER BY c.created_at DESC"
    ).bind(viewer.id).all<any>()).results.map(expand);
  }
  return (await env.DB.prepare(
    "SELECT c.id, c.message, c.status, c.created_at, u.display_name AS adult FROM consultations c JOIN users u ON u.id = c.adult_user_id WHERE c.youth_user_id = ? ORDER BY c.created_at DESC"
  ).bind(viewer.id).all<any>()).results;
}

async function respondConsultation(a: any, viewer: Viewer, env: Env) {
  need(a.id && typeof a.accept === "boolean", "id と accept(true/false) が必要です");
  const r = await env.DB.prepare("UPDATE consultations SET status = ? WHERE id = ? AND adult_user_id = ? AND status = 'requested'")
    .bind(a.accept ? "accepted" : "declined", a.id, viewer.id).run();
  need(r.meta.changes, "対象の相談が見つからないか、すでに返答済みです");
  return { id: a.id, status: a.accept ? "accepted" : "declined" };
}

// ---------- 登録・プロフィール ----------
const YOUTH_FIELDS = ["grade", "school_year", "district", "interests", "can_do", "current_idea", "idea_category", "worries", "personality", "wants_from_adult", "wants_peer", "available_times", "mobility", "guardian_consent", "open_to_peers"];
const ADULT_FIELDS = ["kind", "age_range", "occupation", "district", "life_story", "why_support", "categories", "skills", "failures_to_share", "personality", "communication", "support_modes", "frequency", "available_times", "target_grades", "not_good_at"];
const enc = (v: unknown) => (Array.isArray(v) || (v && typeof v === "object") ? JSON.stringify(v) : typeof v === "boolean" ? (v ? 1 : 0) : v);

// プロフィールの必須項目チェックと INSERT 文
function profileInsert(role: "youth" | "adult", userId: string, a: any, env: Env) {
  need(a.display_name, "display_name（若者はニックネーム）が必要です");
  need(DISTRICTS.includes(a.district), `district は ${DISTRICTS.join("/")} のどれか`);
  if (role === "youth") { need(GRADES.includes(a.grade), "grade は 小/中/高/大/専門"); need(a.interests, "interests が必要です"); }
  else need(a.kind && a.occupation && a.categories && a.skills && a.support_modes && a.target_grades, "kind, occupation, categories, skills, support_modes, target_grades が必要です");
  const cols = (role === "youth" ? YOUTH_FIELDS : ADULT_FIELDS).filter((f) => a[f] !== undefined);
  const table = role === "youth" ? "youth_profiles" : "adult_profiles";
  return env.DB.prepare(`INSERT INTO ${table} (user_id, ${cols.join(",")}) VALUES (?, ${cols.map(() => "?").join(",")})`).bind(userId, ...cols.map((c) => enc(a[c])));
}

// 白紙アカウント（プロフィール未登録）の初回登録
async function setupProfile(a: any, viewer: Viewer, env: Env) {
  need(viewer.onboarding, "すでにプロフィールがあります。変更は update_profile で");
  const role = viewer.role as "youth" | "adult";
  await env.DB.batch([
    profileInsert(role, viewer.id!, a, env),
    env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(a.display_name, viewer.id),
  ]);
  return {
    id: viewer.id, role, display_name: a.display_name,
    note: role === "adult" ? "登録しました。窓口の確認（verified）が済むまで、若者からの相談は届きません" : "登録しました。これで大人への相談申し込みなど、すべての機能が使えます",
  };
}

async function registerProfile(a: any, env: Env) {
  need(a.role === "youth" || a.role === "adult", "role は youth か adult");
  const id = (a.role === "youth" ? "y" : "a") + crypto.randomUUID().slice(0, 6);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, role, display_name, status) VALUES (?,?,?,?)").bind(id, a.role, a.display_name ?? "", "active"),
    profileInsert(a.role, id, a, env),
  ]);
  return {
    id, role: a.role,
    note: a.role === "adult" ? "窓口の確認（verified）が済むまで、若者からの相談は届きません" : "登録しました",
    demo_connect: `MCPのURLを /mcp?as=${id} にすると、この人として使えます`,
  };
}

async function updateProfile(a: any, viewer: Viewer, env: Env) {
  const fields = viewer.role === "youth" ? YOUTH_FIELDS : ADULT_FIELDS.filter((f) => f !== "kind");
  const cols = fields.filter((f) => a[f] !== undefined);
  need(cols.length, `更新できる項目: ${fields.join(", ")}`);
  const table = viewer.role === "youth" ? "youth_profiles" : "adult_profiles";
  await env.DB.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE user_id = ?`).bind(...cols.map((c) => enc(a[c])), viewer.id).run();
  return { updated: cols };
}

// ---------- ツール一覧 ----------
const S = (props: Record<string, any>, required: string[] = []) => ({ type: "object", properties: props, required });
const str = (d: string, e?: readonly string[]) => (e ? { type: "string", description: d, enum: e } : { type: "string", description: d });
const strs = (d: string) => ({ type: "array", items: { type: "string" }, description: d });
const num = (d: string) => ({ type: "number", description: d });
const cat = str("活動の種類で絞る", CATEGORIES);
const dist = str("地区で絞る", DISTRICTS);
const grade = str("学年区分で絞る", GRADES);
const keys = strs("キーワードで絞る（どれかを含むもの）");
const ALL: Role[] = ["youth", "adult", "staff", "guest"];
const ADULT: Role[] = ["adult", "staff"];

const PROFILE_PROPS = {
  grade: str("学年区分", GRADES), school_year: str("例: 高校2年"), interests: strs("興味"), can_do: strs("できること"), current_idea: str("やってみたいこと"), idea_category: str("活動の種類", CATEGORIES),
  worries: strs("不安"), personality: strs("性格"), wants_from_adult: str("大人に求めること"), wants_peer: str("仲間に求めること"), available_times: strs("空いている時間"), mobility: str("移動手段"), guardian_consent: { type: "boolean" }, open_to_peers: { type: "boolean" },
  kind: str("大人の種類", ["mentor", "professional", "provider"]), age_range: str("年代"), occupation: str("職業"), life_story: str("経歴"), why_support: str("応援する理由"),
  categories: strs("得意な活動の種類"), skills: strs("得意なこと"), failures_to_share: str("話せる失敗談"), communication: str("関わり方のスタイル"),
  support_modes: strs("chat/meet/onsite/review/introduce/lend"), frequency: str("頻度"), target_grades: strs("対象学年"), not_good_at: str("苦手なこと"),
};

// when: onboarding=プロフィール未登録の人だけ / ready=登録済みの人だけ
export const TOOLS: { name: string; description: string; inputSchema: any; roles: Role[]; when?: "onboarding" | "ready" }[] = [
  { name: "whoami", roles: ALL, description: "いまの利用者（若者/大人）と、その人のプロフィール全項目を返す", inputSchema: S({}) },
  { name: "list_demo_users", roles: ALL, description: "【デモ用】切り替えられる利用者の一覧", inputSchema: S({}) },
  { name: "get_region", roles: ALL, description: "雪越市（架空）の地区・地域課題・活動の種類の一覧を返す", inputSchema: S({}) },
  { name: "register_profile", roles: ["guest", "staff"], description: "若者または大人として新規登録する。大人は窓口確認後に相談を受けられる", inputSchema: S({
    role: str("youth か adult", ["youth", "adult"]), display_name: str("若者はニックネーム、大人は名前"), district: str("地区", DISTRICTS),
    ...PROFILE_PROPS,
  }, ["role", "display_name", "district"]) },
  { name: "setup_profile", roles: ["youth", "adult"], when: "onboarding", description: "【初めての利用者だけ】会話で聞いた内容でプロフィールを初回登録する。登録前に本人に内容を確認すること。若者の必須: display_name（ニックネーム）, grade, district, interests", inputSchema: S({ display_name: str("若者はニックネーム（本名は聞かない）、大人は名前"), district: str("地区", DISTRICTS), ...PROFILE_PROPS }, ["display_name", "district"]) },
  { name: "update_profile", roles: ["youth", "adult"], when: "ready", description: "自分のプロフィールを更新する（項目は register_profile と同じ）", inputSchema: { type: "object", additionalProperties: true } },

  { name: "find_adults", roles: ALL, description: "地域の大人（メンター・専門職・場所や機材の提供者）のプロフィールを返す。経歴・応援する理由・得意なこと・失敗談・性格・関わり方・空き時間・対象学年・苦手なことを含む。条件は省略可（省略で全員）", inputSchema: S({ kind: str("種類で絞る", ["mentor", "professional", "provider"]), category: cat, grade: str("対象学年に含むかで絞る", GRADES), district: dist, keywords: keys }) },
  { name: "find_peers", roles: ["youth", "staff"], description: "仲間検索に公開OKの若者のプロフィールを返す（興味・できること・やりたいこと・仲間に求めること等）", inputSchema: S({ grade, district: dist, category: cat, keywords: keys }) },
  { name: "find_resources", roles: ALL, description: "場所・機材・名義貸し・保険・テンプレート・移動手段を返す", inputSchema: S({ type: str("種類で絞る", ["space", "shop", "equipment", "name_lending", "insurance", "template", "transport"]), district: dist, max_cost: num("費用の上限（円）"), winter: { type: "boolean", description: "冬も使えるものだけ" }, keywords: keys }) },
  { name: "find_grants", roles: ALL, description: "補助金・助成金を返す", inputSchema: S({ category: cat, grade, min_amount: num("上限額がこの金額以上のもの") }) },
  { name: "find_cases", roles: ALL, description: "先輩の活動事例を返す（費用の内訳・準備期間・最初にやったこと・学び・協力した人や場所のID）", inputSchema: S({ category: cat, grade, scale: str("規模", ["小", "中", "大"]), district: dist, keywords: keys }) },

  { name: "get_encouragement_guide", roles: ALL, description: "【最重要】若者の背中の押し方ガイド。若者と話す前に必ず読む。守る原則・会話の流れ・学年ごとの話し方・段階ごとの関わり方・不安ごとの安心材料・OK/NGの声かけ例・AIだけで抱えない場面を返す。audience=adult で大人が返事を書くときの助言", inputSchema: S({ audience: str("誰と話すか（既定 youth）", ["youth", "adult"]), kind: str("種類で絞る", ["principle", "flow", "grade_tone", "stage", "worry", "safety", "adult"]), stage: str("段階", ["idea", "planning", "stuck", "just_before", "after"]), grade, worries: strs("若者の不安（該当する worry だけ返す）") }) },
  { name: "find_vendors", roles: ALL, description: "見積もり用に、架空の業者（印刷・イベント機材・バス・飲食・保険・資材）とその価格表を返す。同じ item_key で複数社を比べられ、学割・納期・最低注文数・強みも含む", inputSchema: S({ type: str("業種", ["印刷", "イベント機材", "バス・送迎", "飲食・ケータリング", "保険", "包装・資材"]), item_key: str("品目キー（例 flyer_a4_100, pa_set_day, bus_halfday, insurance_day）。一覧は item_keys に出る"), district: dist, keywords: keys }) },

  { name: "request_consultation", roles: ["youth"], when: "ready", description: "大人に相談を申し込む（連絡先は窓口経由でつなぐ。未成年は保護者同意が必要）", inputSchema: S({ adult_id: str("大人のID"), message: str("相談したいこと") }, ["adult_id", "message"]) },
  { name: "list_my_consultations", roles: ["youth", "adult"], when: "ready", description: "自分に関係する相談の一覧（大人は届いた相談、若者は申し込んだ相談）", inputSchema: S({}) },
  { name: "respond_consultation", roles: ADULT, when: "ready", description: "届いた相談を受ける/断る", inputSchema: S({ id: str("相談ID"), accept: { type: "boolean" } }, ["id", "accept"]) },
];

export async function callTool(name: string, a: any, viewer: Viewer, env: Env): Promise<unknown> {
  switch (name) {
    case "whoami": return whoami(viewer, env);
    case "list_demo_users": return listDemoUsers(env);
    case "get_region": return REGION;
    case "register_profile": return registerProfile(a, env);
    case "setup_profile": return setupProfile(a, viewer, env);
    case "update_profile": return updateProfile(a, viewer, env);
    case "find_adults": return findAdults(a, env);
    case "find_peers": return findPeers(a, viewer, env);
    case "find_resources": return findResources(a, env);
    case "find_grants": return findGrants(a, env);
    case "find_cases": return findCases(a, env);
    case "get_encouragement_guide": return getEncouragementGuide(a, env);
    case "find_vendors": return findVendors(a, env);
    case "request_consultation": return requestConsultation(a, viewer, env);
    case "list_my_consultations": return listMyConsultations(viewer, env);
    case "respond_consultation": return respondConsultation(a, viewer, env);
  }
  throw new Error(`未実装: ${name}`);
}
