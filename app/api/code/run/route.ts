import { NextRequest } from "next/server";
import { z } from "zod";
import { verifyRequest, jsonError } from "@/lib/auth/server-auth";
import { runCode } from "@/lib/code/runner";
import { incrementUsage } from "@/lib/supabase/usage";
import { getUsageContext, planGateResponse } from "@/lib/usage/server";
import { getFeatureLimit, getUpgradeMessage, getRequiredPlan } from "@/lib/plans/gates";

export const runtime = "nodejs";
export const maxDuration = 60;

const runCodeRequestSchema = z.object({
  code: z.string().min(1),
  language: z.enum(["python", "javascript"]),
  stdin: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await verifyRequest(req);
  } catch {
    return jsonError("Forge auth is misconfigured. Check Firebase Admin credentials.", 500);
  }
  if (!user) return jsonError("unauthorized", 401);

  let parsed: z.infer<typeof runCodeRequestSchema>;
  try {
    parsed = runCodeRequestSchema.parse(await req.json());
  } catch {
    return jsonError("Invalid code execution request.", 400);
  }

  // --- plan gate: code execution (§STEP 2) ---
  const ctx = await getUsageContext(user.uid);
  const limit = getFeatureLimit(ctx.plan, "code_executions");
  if (limit === 0) {
    return planGateResponse({
      feature: "code_executions",
      message: getUpgradeMessage(ctx.plan, "Code execution"),
      requiredPlan: getRequiredPlan("Code execution"),
    });
  }
  if (ctx.codeExecutions >= limit) {
    return planGateResponse({
      feature: "code_executions",
      message: "Monthly code execution limit reached.",
      requiredPlan: "pro",
    });
  }

  const result = await runCode(parsed.code, parsed.language, parsed.stdin ?? "");
  await incrementUsage(user.uid, { codeExecutions: 1 }); // §STEP 3 monthly counter
  return Response.json(result);
}
