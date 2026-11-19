// wrangler をプロジェクト内の一時フォルダで動かす
// （Windows で workerd が既定のTEMPにフォルダを作れず落ちることがあるため）
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const tmp = resolve(".wrangler/tmpdir");
mkdirSync(tmp, { recursive: true });
const env = { ...process.env, TMP: tmp, TEMP: tmp, TMPDIR: tmp, WRANGLER_SEND_METRICS: "false" };
const child = spawn("npx", ["wrangler", ...process.argv.slice(2)], { stdio: "inherit", env, shell: true });
child.on("exit", (code) => process.exit(code ?? 1));
