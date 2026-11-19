// 雪越市 若者チャレンジ支援 MCPサーバー（Cloudflare Worker）
// MCP Streamable HTTP の最小実装: POST /mcp に JSON-RPC を送り、JSON で返す
import { TOOLS, callTool, getEncouragementGuide, type Env, type Viewer } from "./tools";

// ---------- MCPプロンプト（背中押しモードを配る。中身はDBのガイドから組み立てる） ----------
const PROMPTS = [
  { name: "youth_supporter", title: "背中押しモード（若者と話す）", description: "若者の『やってみたい』を全肯定で後押しする話し方・会話の流れ・不安への答え方を設定する", arguments: [{ name: "grade", description: "相手の学年区分（小/中/高/大/専門）", required: false }] },
  { name: "adult_reply_helper", title: "大人の返事サポート", description: "若者から相談を受けた大人が、やる気を折らない返事を書くのを手伝う", arguments: [] },
];

const CORE_PRINCIPLES =
  "【背中押しの原則】①アイデアをまず全部肯定する ②良いところを具体的にほめる ③一歩は小さく1つだけ ④大人の失敗談と根拠のある数字で安心させる ⑤選ぶのは本人（相談申込も本人の了承後）⑥『難しい』『まだ早い』などは言わない。" +
  "若者と話す前に get_encouragement_guide を必ず読むこと。";

async function buildPrompt(name: string, args: Record<string, string>, env: Env) {
  const fmt = (g: any) =>
    [`■ ${g.title}`, g.content, g.steps?.length ? g.steps.join("\n") : "", g.ok_examples?.length ? `OK例: ${g.ok_examples.join(" / ")}` : "", g.ng_examples?.length ? `NG例: ${g.ng_examples.join(" / ")}` : ""]
      .filter(Boolean).join("\n");
  if (name === "youth_supporter") {
    const { guide } = await getEncouragementGuide({ audience: "youth", grade: args.grade }, env);
    const pick = (k: string) => guide.filter((g: any) => g.kind === k).map(fmt).join("\n\n");
    const text = [
      "あなたは雪越市の若者チャレンジを応援する伴走者です。判断と声かけはあなたが行い、データはMCPツールから取得します。数字はツールで得たものだけを使ってください。",
      "# 守る原則", pick("principle"),
      "# 会話の流れ", pick("flow"),
      "# 相手に合わせた話し方", pick("grade_tone"),
      "# 段階ごとの関わり方", pick("stage"),
      "# AIだけで抱えない場面", pick("safety"),
      "# 不安への答え方", "若者が不安を話したら get_encouragement_guide(worries=[...]) で該当する材料を取り、refer にあるツールで具体的な数字や人を出してください。",
      "まず whoami でプロフィールを確認してから話し始めてください。",
    ].join("\n\n");
    return { description: PROMPTS[0].description, messages: [{ role: "user", content: { type: "text", text } }] };
  }
  if (name === "adult_reply_helper") {
    const { guide } = await getEncouragementGuide({ audience: "adult" }, env);
    const text = ["あなたは地域の大人が若者に返事を書くのを手伝います。list_my_consultations で相談を確認し、下のガイドに沿って返事の下書きを作ってください。", ...guide.map(fmt)].join("\n\n");
    return { description: PROMPTS[1].description, messages: [{ role: "user", content: { type: "text", text } }] };
  }
  throw new Error(`不明なプロンプト: ${name}`);
}

const PROTOCOL_VERSION = "2025-03-26";
const SERVER_INFO = { name: "vitality", title: "vitality", version: "0.2.0" };

type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: any };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, X-Demo-User",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

// 誰として使っているか。デモは ?as=<id> か X-Demo-User ヘッダ。本番はOAuthのトークンから引く
async function resolveViewer(req: Request, env: Env): Promise<Viewer> {
  const url = new URL(req.url);
  const asId = url.searchParams.get("as") ?? req.headers.get("X-Demo-User");
  if (env.DEMO_MODE === "true" && asId) {
    const u = await env.DB.prepare("SELECT id, role, display_name FROM users WHERE id = ? AND status = 'active'")
      .bind(asId).first<{ id: string; role: string; display_name: string }>();
    if (u) {
      const table = u.role === "youth" ? "youth_profiles" : "adult_profiles";
      const p = u.role === "staff" ? 1 : await env.DB.prepare(`SELECT 1 FROM ${table} WHERE user_id = ?`).bind(u.id).first();
      return { id: u.id, role: u.role as Viewer["role"], name: u.display_name, onboarding: !p };
    }
  }
  return { id: null, role: "guest", name: "ゲスト", onboarding: false };
}

// 立場と、プロフィール登録前（onboarding）かどうかで使えるツールを決める
const allowed = (t: (typeof TOOLS)[number], v: Viewer) =>
  t.roles.includes(v.role) && !(t.when === "onboarding" && !v.onboarding) && !(t.when === "ready" && v.onboarding);

async function handle(msg: RpcRequest, viewer: Viewer, env: Env) {
  const { id, method, params } = msg;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: {}, prompts: {} },
        serverInfo: SERVER_INFO,
        instructions:
          `vitality：雪越市（架空）の若者チャレンジ支援サーバーです。いまの利用者: ${viewer.name}（${viewer.role}）。` +
          "このサーバーはデータを返すだけです。誰が合うか・どう後押しするかはあなた（AI）が判断してください。" +
          "まず whoami で利用者のプロフィールを確認し、find_* で候補を集めて比べます。連絡先は直接渡さず request_consultation でつなぎます。" +
          CORE_PRINCIPLES +
          "利用者が「記録して」「メモして」と言ったときだけ add_log で記録し、振り返りを頼まれたら list_logs を使ってください（勝手に記録しないこと）。" +
          (viewer.onboarding
            ? (viewer.role === "youth"
              ? "【この人は初めての利用者で、プロフィールはまだ空です】最初にあいさつし、このサービスで何ができるかを短く伝えてから、やってみたいことを聞いてください。" +
                "ニックネーム・学年・地区・興味などは会話の中で少しずつ自然に聞き、一度に質問攻めにしないこと。必要な項目がそろったら本人に確認して setup_profile で登録してください。" +
                "get_encouragement_guide(kind=flow) の『初めての人との会話』に沿って進めてください。"
              : "【この大人は初めての利用者で、プロフィールはまだ空です】若者を応援する仕組みを短く説明し、経歴・得意なこと・応援したい理由・関わり方を会話で聞いて、確認のうえ setup_profile で登録してください。")
            : ""),
      });
    case "prompts/list":
      return ok({ prompts: PROMPTS.filter((p) => viewer.role !== "youth" || p.name !== "adult_reply_helper").filter((p) => viewer.role !== "adult" || p.name !== "youth_supporter") });
    case "prompts/get":
      try { return ok(await buildPrompt(params?.name, params?.arguments ?? {}, env)); }
      catch (e: any) { return err(-32602, String(e?.message ?? e)); }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS.filter((t) => allowed(t, viewer)).map(({ roles, when, ...t }) => t) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return err(-32602, `不明なツール: ${params?.name}`);
      if (!allowed(tool, viewer))
        return ok({ isError: true, content: [{ type: "text", text: viewer.onboarding && tool.when === "ready"
          ? "先に setup_profile でプロフィールを登録してください"
          : `このツールはいまの利用者（${viewer.role}）では使えません` }] });
      try {
        const result = await callTool(tool.name, params?.arguments ?? {}, viewer, env);
        return ok({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (e: any) {
        return ok({ isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] });
      }
    }
    default:
      return err(-32601, `未対応のメソッド: ${method}`);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/") return json({ name: SERVER_INFO.name, mcp: "/mcp", demo: "?as=y001（若者）/ ?as=a001（大人）" });
    if (url.pathname !== "/mcp") return json({ error: "not found" }, 404);
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST", ...CORS } });

    let body: RpcRequest | RpcRequest[];
    try { body = await req.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }

    const viewer = await resolveViewer(req, env);
    const msgs = Array.isArray(body) ? body : [body];
    const replies = [];
    for (const m of msgs) if (m.id !== undefined && m.id !== null) replies.push(await handle(m, viewer, env));
    if (replies.length === 0) return new Response(null, { status: 202, headers: CORS }); // 通知だけ
    return json(Array.isArray(body) ? replies : replies[0]);
  },
};
