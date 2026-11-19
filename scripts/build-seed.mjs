// data/*.json から D1 用の seed.sql を作る
import { readFileSync, writeFileSync } from "node:fs";

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url), "utf8"));
const q = (v) =>
  v === null || v === undefined ? "NULL"
  : typeof v === "number" ? String(v)
  : typeof v === "boolean" ? (v ? "1" : "0")
  : `'${(typeof v === "object" ? JSON.stringify(v) : String(v)).replace(/'/g, "''")}'`;
const insert = (table, row) =>
  `INSERT INTO ${table} (${Object.keys(row).map((k) => `"${k}"`).join(",")}) VALUES (${Object.values(row).map(q).join(",")});`;

const out = [];
for (const a of load("adults")) {
  const { id, display_name, ...p } = a;
  out.push(insert("users", { id, role: "adult", display_name }));
  out.push(insert("adult_profiles", { user_id: id, ...p }));
}
for (const y of load("youth")) {
  const { id, display_name, ...p } = y;
  out.push(insert("users", { id, role: "youth", display_name }));
  out.push(insert("youth_profiles", { user_id: id, ...p }));
}
for (const t of ["resources", "grants", "cases", "encouragement", "vendors", "vendor_prices"]) for (const r of load(t)) out.push(insert(t, r));

writeFileSync(new URL("../seed.sql", import.meta.url), out.join("\n") + "\n");
console.log(`seed.sql: ${out.length} rows`);
