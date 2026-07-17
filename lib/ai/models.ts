// THE ONLY FILE THAT KNOWS REAL PROVIDER MODEL STRINGS. SERVER-ONLY.
//
// FORGE-NOTE: The master spec colocates FORGE_MODELS_PUBLIC here, but a
// server-only module cannot be imported by client components. The public,
// provider-free metadata lives in ./models.public.ts; this file adds the
// provider mapping on top. The invariant is preserved: provider identifiers
// exist only in this server-only module. Each model carries its own thinking
// toggle (passed as a request param), so the model is chosen purely by the
// Forge model id — never by the thinking flag.
import "server-only";
import type { ForgeModelId } from "./models.public";

const PROVIDER_MODEL: Record<ForgeModelId, string> = {
  "spark-2.5": "deepseek-v4-flash",
  "magnum-2.8": "deepseek-v4-pro",
};

export function resolveProviderModel(id: ForgeModelId): string {
  return PROVIDER_MODEL[id];
}

export type { ForgeModelId };
