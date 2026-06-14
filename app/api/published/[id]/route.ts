import { NextRequest } from "next/server";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** PUBLIC read of a published project (no auth) — backs the /p/[id] page.
 *  Reads via the service-role client, so RLS staying locked down is fine. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  if (!supabaseConfigured) return Response.json(null, { status: 503 });
  const { id } = await ctx.params;
  const { data } = await supabaseAdmin
    .from("published")
    .select("name, html")
    .eq("id", id)
    .maybeSingle();
  if (!data) return Response.json(null, { status: 404 });
  return Response.json({ name: data.name, html: data.html });
}
