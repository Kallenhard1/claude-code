// Bundles the extension entry points into dist/.
//  - dist/extension.js       : extension host (vscode provided at runtime, external)
//  - dist/mcp-bridge.js       : standalone MCP stdio server launched by the CLI
//                               (proxies IDE tools INTO Claude Code)
//  - dist/ask-claude-server.js: standalone MCP stdio server launched by an MCP
//                               client (proxies a prompt OUT to Claude Code)
const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  logLevel: "info",
};

/** @type {import('esbuild').BuildOptions[]} */
const builds = [
  {
    ...shared,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    external: ["vscode"],
  },
  {
    ...shared,
    entryPoints: ["src/mcp/mcpBridge.ts"],
    outfile: "dist/mcp-bridge.js",
  },
  {
    ...shared,
    entryPoints: ["src/mcp/askClaudeServer.ts"],
    outfile: "dist/ask-claude-server.js",
  },
];

async function main() {
  if (watch) {
    for (const options of builds) {
      const ctx = await esbuild.context(options);
      await ctx.watch();
    }
    console.log("[esbuild] watching...");
  } else {
    await Promise.all(builds.map((options) => esbuild.build(options)));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
