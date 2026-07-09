#!/usr/bin/env node
// A stand-in for the official `claude` CLI, used by the driver so the bridge's
// stream-json → OpenAI translation can be exercised without real Anthropic
// auth. It mimics `claude -p <prompt> --output-format stream-json
// --include-partial-messages --verbose [--model X]`: prints newline-delimited
// stream-json events and exits 0.
//
// If FAKE_CLAUDE_ARGS_OUT is set, it writes its argv there so the driver can
// assert the resolved `--model` (e.g. opus-4.8-bridge → opus) actually reached
// the CLI.
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
if (process.env.FAKE_CLAUDE_ARGS_OUT) {
  writeFileSync(process.env.FAKE_CLAUDE_ARGS_OUT, JSON.stringify(argv));
}

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

emit({
  type: "system",
  subtype: "init",
  session_id: "fake-session-1",
  model: "fake-model",
  tools: [],
  mcp_servers: [],
});
emit({ type: "stream_event", event: { type: "message_start" } });
for (const text of ["Hello ", "from ", "fake claude"]) {
  emit({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text },
    },
  });
}
emit({
  type: "result",
  session_id: "fake-session-1",
  is_error: false,
  total_cost_usd: 0.0012,
  usage: { input_tokens: 7, output_tokens: 3 },
});
process.exit(0);
