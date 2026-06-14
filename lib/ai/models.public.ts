// Client-safe model metadata. Contains NO provider identifiers.
// The server-only mapping (./models.ts) is the single place that knows the
// real provider strings.

export const FORGE_MODELS_PUBLIC = {
  "spark-2.5": {
    label: "Spark 2.5",
    blurb: "Fast and efficient for everyday work",
  },
  "magnum-2.8": {
    label: "Magnum 2.8",
    blurb: "Most capable for ambitious work",
  },
} as const;

export type ForgeModelId = keyof typeof FORGE_MODELS_PUBLIC;

export const FORGE_MODEL_IDS = Object.keys(
  FORGE_MODELS_PUBLIC
) as ForgeModelId[];

// New users start on Spark (fast/efficient) at Low effort — see DEFAULT_EFFORT.
// Forge Code builds override this to Magnum for reliability (see build-dock).
export const DEFAULT_MODEL: ForgeModelId = "spark-2.5";

export function isForgeModelId(v: unknown): v is ForgeModelId {
  return typeof v === "string" && v in FORGE_MODELS_PUBLIC;
}

export function modelLabel(id: ForgeModelId): string {
  return FORGE_MODELS_PUBLIC[id].label;
}
