#!/usr/bin/env node
// Headless driver for the Cursor ⇄ Claude Code bridge's OpenAI-compatible
// endpoint (src/openaiBridgeServer.ts). It bundles the REAL server module with
// a stubbed `vscode` (vscode-stub.cjs), points it at a fake `claude` CLI
// (fake-claude.mjs), starts the loopback HTTP server, and drives every route:
//   GET  /health
//   GET  /v1/models
//   POST /v1/chat/completions  (auth rejection, non-stream, stream)
// and asserts the model id → --model translation reached the CLI.
//
// Run:  node .claude/skills/run-cursor-claude-extension-bridge/driver.mjs
// Env:  PORT (default 8799)  ·  KEEPALIVE=1 to leave the server running.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mkdtempSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";

const skillDir = dirname(fileURLToPath(import.meta.url));
const unitDir = resolve(skillDir, "..", "..", ".."); // cursor-claude-extension-bridge/
const srcDir = join(unitDir, "src");
const PORT = Number(process.env.PORT || 8799);
const API_KEY = "test-secret-key";
const require = createRequire(import.meta.url);

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

// 1. Bundle the real server module with vscode aliased to the stub.
const outDir = mkdtempSync(join(tmpdir(), "bridge-driver-"));
const outFile = join(outDir, "server.cjs");
await build({
  stdin: {
    contents: `export { OpenAiBridgeServer } from "./openaiBridgeServer";`,
    resolveDir: srcDir,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outfile: outFile,
  alias: { vscode: join(skillDir, "vscode-stub.cjs") },
  logLevel: "warning",
});
const { OpenAiBridgeServer } = require(outFile);

// 2. Configure via the stub's global config map.
const fakeClaude = join(skillDir, "fake-claude.mjs");
chmodSync(fakeClaude, 0o755);
const argsOut = join(outDir, "cli-args.json");
process.env.FAKE_CLAUDE_ARGS_OUT = argsOut;
globalThis.__vscodeConfig = {
  "openaiEndpoint.enabled": true,
  "openaiEndpoint.port": PORT,
  "openaiEndpoint.apiKey": API_KEY,
  enableToolBridge: false, // skip the MCP tool bridge (needs a real host)
  allowedTools: [],
  cliPath: fakeClaude, // drive the fake CLI, no real auth needed
  cwd: outDir,
  permissionMode: "default",
};

// 3. Start the real server. Fake ToolBridgeServer (unused: enableToolBridge=false).
const logs = [];
const server = new OpenAiBridgeServer(
  { start: async () => undefined, dispose() {} },
  (m) => logs.push(m),
);
await server.start();
const state = server.getState();
ok("server.start() → listening", state.status === "listening", JSON.stringify(state));
const base = `http://127.0.0.1:${PORT}`;
// When openaiEndpoint.apiKey is set, the server gates EVERY route (auth runs
// before routing), so all requests below carry the bearer token.
const auth = { "content-type": "application/json", authorization: `Bearer ${API_KEY}` };

try {
  // GET /health
  const health = await fetch(`${base}/health`, { headers: auth });
  const healthBody = await health.json();
  ok("GET /health → 200 ok", health.status === 200 && healthBody.status === "ok");

  // GET /v1/models
  const models = await fetch(`${base}/v1/models`, { headers: auth });
  const modelsBody = await models.json();
  const ids = (modelsBody.data || []).map((m) => m.id);
  ok(
    "GET /v1/models lists the 3 bridge models",
    ["opus-4.8-bridge", "sonnet-4.5-bridge", "haiku-4.5-bridge"].every((id) =>
      ids.includes(id),
    ),
    ids.join(","),
  );

  // POST /v1/chat/completions with WRONG key → 401 (apiKey auth)
  const unauth = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer nope" },
    body: JSON.stringify({ model: "opus-4.8-bridge", messages: [{ role: "user", content: "hi" }] }),
  });
  ok("POST with wrong api key → 401", unauth.status === 401);

  // POST non-streaming with correct key → real translation of fake stream-json
  const nonStream = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      model: "opus-4.8-bridge",
      stream: false,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  const nsBody = await nonStream.json();
  const content = nsBody?.choices?.[0]?.message?.content;
  ok("POST (non-stream) → assistant text assembled", content === "Hello from fake claude", String(content));
  ok(
    "POST (non-stream) → usage tokens surfaced",
    nsBody?.usage?.completion_tokens === 3 && nsBody?.usage?.prompt_tokens === 7,
    JSON.stringify(nsBody?.usage),
  );

  // Assert model id → --model translation reached the CLI
  const cliArgs = JSON.parse(readFileSync(argsOut, "utf8"));
  const mi = cliArgs.indexOf("--model");
  ok(
    "opus-4.8-bridge translated to `--model opus` for the CLI",
    mi !== -1 && cliArgs[mi + 1] === "opus",
    cliArgs.join(" "),
  );

  // POST streaming → SSE chunks, ends with [DONE]
  const streamRes = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      model: "sonnet-4.5-bridge",
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  const sse = await streamRes.text();
  const streamed = [...sse.matchAll(/"content":"([^"]*)"/g)].map((m) => m[1]).join("");
  ok("POST (stream) → SSE assembles same text", streamed === "Hello from fake claude", streamed);
  ok("POST (stream) → terminates with [DONE]", sse.includes("data: [DONE]"));
} finally {
  console.log(`\n[endpoint log lines: ${logs.length}] e.g. ${logs[0] || "(none)"}`);
  if (!process.env.KEEPALIVE) await server.stop();
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
if (process.env.KEEPALIVE) {
  console.log(`\nKEEPALIVE — endpoint left running at ${base}/v1 (Ctrl-C to stop).`);
  console.log(`Try: curl -s -H "authorization: Bearer ${API_KEY}" ${base}/v1/models`);
} else {
  process.exit(fail === 0 ? 0 : 1);
}
