// ローカルの wrangler dev に対して主要ツールを呼ぶ確認スクリプト
const BASE = process.env.MCP_URL ?? "http://localhost:8787/mcp";
let n = 0, fail = 0;
async function rpc(as, method, params) {
  const url = as ? `${BASE}?as=${as}` : BASE;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) });
  return res.json();
}
const call = async (as, name, args = {}) => {
  const r = await rpc(as, "tools/call", { name, arguments: args });
  const c = r.result?.content?.[0]?.text ?? JSON.stringify(r.error);
  return { isError: !!r.result?.isError || !!r.error, data: (() => { try { return JSON.parse(c); } catch { return c; } })() };
};
const check = (label, cond, info = "") => { console.log(`${cond ? "OK  " : "NG  "} ${label}${info ? "  " + info : ""}`); if (!cond) fail++; };

const init = await rpc("y001", "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
check("initialize", init.result?.serverInfo?.name);
const yt = (await rpc("y001", "tools/list")).result.tools.map((t) => t.name);
const at = (await rpc("a001", "tools/list")).result.tools.map((t) => t.name);
const gt = (await rpc(null, "tools/list")).result.tools.map((t) => t.name);
check("若者のツール", yt.includes("find_peers") && yt.includes("request_consultation") && !yt.includes("respond_consultation"), yt.join(","));
check("大人のツール", at.includes("respond_consultation") && !at.includes("request_consultation") && !at.includes("find_peers"), at.join(","));
check("ゲストのツール", gt.includes("register_profile") && !gt.includes("request_consultation"), gt.join(","));
check("大人は若者ツールを呼べない", (await call("a001", "request_consultation", { adult_id: "a002", message: "x" })).isError);
check("点数付けをしていない", !JSON.stringify(await call("y001", "find_adults")).includes("match_score"));

const all = await call("y001", "find_adults");
check("find_adults 全員", all.data.count === 20 && all.data.adults[0].life_story, `${all.data.count}人`);
const f = await call("y001", "find_adults", { category: "art", grade: "高" });
check("find_adults 絞り込み", f.data.adults.every((x) => x.categories.includes("art") && x.target_grades.includes("高")), f.data.adults.map((x) => x.name).join(", "));
const p = await call("y001", "find_peers", { keywords: ["チラシ"] });
check("find_peers", p.data.count > 0 && !p.data.peers.some((x) => x.id === "y001" || "mobility" in x), p.data.peers.map((x) => x.nickname).join(", "));
check("find_resources", (await call("y001", "find_resources", { type: "equipment", max_cost: 500 })).data.count > 0);
check("find_grants", (await call("y001", "find_grants", { grade: "高", category: "event" })).data.count > 0);
check("find_cases", (await call("y001", "find_cases", { category: "event" })).data.cases[0].budget_items.length > 0);
const g = await call("y001", "get_encouragement_guide", { worries: ["会場代が払えるか", "親にどう説明するか"], grade: "高" });
check("背中押しガイド（不安で絞る）", g.data.guide.filter((x) => x.kind === "worry").length === 2 && g.data.guide.some((x) => x.kind === "principle"), g.data.guide.filter((x) => x.kind === "worry").map((x) => x.title).join(" / "));
const gt2 = await call("y004", "get_encouragement_guide", { kind: "grade_tone", grade: "中" });
check("学年ごとの話し方", gt2.data.count === 1 && gt2.data.guide[0].title.includes("中学生"));
const ga = await call("a001", "get_encouragement_guide", { audience: "adult" });
check("大人向けガイド", ga.data.guide.every((x) => x.audience === "adult") && ga.data.count >= 2);
const k = await call("y001", "find_vendors", { item_key: "flyer_a4_100" });
check("業者比較（チラシ3社）", k.data.count === 3 && k.data.vendors.every((v) => v.prices[0].item_key === "flyer_a4_100"), k.data.vendors.map((v) => v.name + ":" + v.prices[0].price + "円").join(", "));
const k2 = await call("y001", "find_vendors", { type: "バス・送迎" });
check("業種で絞る", k2.data.count === 3);
const pl = await rpc("y001", "prompts/list");
check("プロンプト一覧（若者）", pl.result.prompts.map((p) => p.name).join() === "youth_supporter");
const pg = await rpc("y001", "prompts/get", { name: "youth_supporter", arguments: { grade: "高" } });
const ptext = pg.result?.messages?.[0]?.content?.text ?? "";
check("背中押しモードのプロンプト", ptext.includes("会話の基本の流れ") && ptext.includes("高校生への話し方") && !ptext.includes("小学生への話し方"), ptext.length + "文字");
check("get_region", (await call(null, "get_region")).data.districts.honjo);

const req = await call("y001", "request_consultation", { adult_id: "a004", message: "ライブの音響を教えてください" });
check("request_consultation", req.data.status === "requested");
check("同意なし未成年は相談不可", (await call("y014", "request_consultation", { adult_id: "a001", message: "x" })).isError);
check("未確認の大人には相談不可", (await call("y009", "request_consultation", { adult_id: "a019", message: "x" })).isError);
const inbox = await call("a004", "list_my_consultations");
check("大人の受信一覧", inbox.data.some((c) => c.id === req.data.id));
check("respond_consultation", (await call("a004", "respond_consultation", { id: req.data.id, accept: true })).data.status === "accepted");

const reg = await call(null, "register_profile", { role: "youth", display_name: "てすと", district: "honjo", grade: "高", interests: ["写真"], current_idea: "商店街の写真展をやりたい", idea_category: "art", guardian_consent: true });
check("register_profile", reg.data.id?.startsWith("y"), reg.data.id);
const who = await call(reg.data.id, "whoami");
check("登録した人で whoami", who.data.role === "youth" && who.data.profile?.interests?.[0] === "写真");

console.log(fail ? `\n${fail} 件 NG` : "\nすべて OK");
process.exit(fail ? 1 : 0);
