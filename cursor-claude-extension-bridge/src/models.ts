/**
 * The single source of truth for the "bridge" models exposed to Cursor.
 *
 * Each entry surfaces under one id (e.g. `opus-4.8-bridge`) in three places:
 *   - the OpenAI-compatible endpoint's `GET /v1/models` list,
 *   - the "Select Model" quick pick / status bar,
 *   - the `--model` flag handed to the `claude` CLI.
 *
 * The `-bridge` suffix keeps these distinct from Cursor's own model ids so it
 * is obvious in the picker that a request is being routed through this bridge.
 */
export interface BridgeModel {
  /** Id advertised to OpenAI clients / Cursor, e.g. "opus-4.8-bridge". */
  id: string;
  /** Human label for the quick pick. */
  label: string;
  /** One-line description shown in the picker. */
  detail: string;
  /** Value passed to `claude --model` (CLI alias or full model id). */
  cliModel: string;
}

export const BRIDGE_MODELS: BridgeModel[] = [
  {
    id: "opus-4.8-bridge",
    label: "Opus 4.8",
    detail: "Most capable — claude --model opus",
    cliModel: "opus",
  },
  {
    id: "sonnet-4.5-bridge",
    label: "Sonnet 4.5",
    detail: "Balanced — claude --model sonnet",
    cliModel: "sonnet",
  },
  {
    id: "haiku-4.5-bridge",
    label: "Haiku 4.5",
    detail: "Fastest — claude --model haiku",
    cliModel: "haiku",
  },
];

export const DEFAULT_MODEL_ID = "opus-4.8-bridge";

/** Look up a bridge model by its advertised id. */
export function findBridgeModel(id: string | undefined): BridgeModel | undefined {
  return BRIDGE_MODELS.find((m) => m.id === id);
}

/**
 * Resolve an OpenAI/Cursor `model` value to the `--model` argument for the CLI.
 * Falls back to passing an unknown id straight through (so a raw model id or
 * CLI alias also works), and to `undefined` for our own `-bridge` ids we don't
 * recognise (let the CLI use its default rather than an invalid flag).
 */
export function resolveCliModel(id: string | undefined): string | undefined {
  const known = findBridgeModel(id);
  if (known) {
    return known.cliModel;
  }
  if (id && id.trim() && !id.endsWith("-bridge")) {
    return id.trim();
  }
  return undefined;
}
