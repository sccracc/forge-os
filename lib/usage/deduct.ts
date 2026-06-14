import "server-only";
import { deductForgeTokens } from "@/lib/supabase/usage";

export interface DeductResult {
  forgeTokens: number;
  multiplier: number;
  realTokens: number;
}

/**
 * Post-request Forge-token deduction (§STEP 2). Applies the multiplier and rolls
 * it into the user's windows via the `deduct_forge_tokens` RPC.
 *
 *   Spark 2.5  thinking off → 1×   on → 2×
 *   Magnum 2.8 thinking off → 5×   on → 10×
 *
 * NOTE: the RPC arg is passed as a rounded JS number (not a BigInt). A real
 * BigInt cannot be JSON-serialized by the Supabase client and would throw; the
 * numeric value is identical. Never throws (best-effort tracking).
 */
export async function deductTokens(
  userId: string,
  plan: string,
  realTokensUsed: number,
  modelId: string,
  thinkingEnabled: boolean
): Promise<DeductResult> {
  const modelMult = modelId === "magnum-2.8" ? 5 : 1;
  const thinkMult = thinkingEnabled ? 2 : 1;
  const multiplier = modelMult * thinkMult;
  const realTokens = Math.max(0, Math.round(realTokensUsed || 0));
  const forgeTokens = realTokens * multiplier;

  await deductForgeTokens(userId, forgeTokens, plan === "free");

  return { forgeTokens, multiplier, realTokens };
}
