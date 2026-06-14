import { resolvePlanId, type PlanId } from "@/lib/plans/limits";

export type PublicImageModelId = "none" | "forge-image" | "forge-image-pro";

export const PUBLIC_IMAGE_MODEL_NAMES: Record<PublicImageModelId, string> = {
  none: "Not included",
  "forge-image": "Forge Image",
  "forge-image-pro": "Forge Image Pro",
};

export function imageModelForPlan(plan: string | null | undefined): PublicImageModelId {
  const p = resolvePlanId(plan);
  if (p === "max" || p === "ultra") return "forge-image-pro";
  if (p === "starter" || p === "pro") return "forge-image";
  return "none";
}

export function imageModelLabelForPlan(plan: string | null | undefined): string {
  return PUBLIC_IMAGE_MODEL_NAMES[imageModelForPlan(plan)];
}

export function imageModelAccessLine(plan: string | null | undefined): string {
  const p: PlanId = resolvePlanId(plan);
  if (p === "max" || p === "ultra") return "Forge Image Pro";
  if (p === "starter" || p === "pro") return "Forge Image";
  return "No image model";
}
