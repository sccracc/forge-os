import { NextRequest } from "next/server";
import { requireUser, isResponse, readJson, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { fileToInsert, filePatchToUpdate } from "@/lib/supabase/mappers";
import type { FileDoc } from "@/lib/data/types";

export const runtime = "nodejs";

interface BulkBody {
  inserts?: FileDoc[];
  updates?: { id: string; patch: Partial<FileDoc> }[];
  deletes?: string[];
}

/**
 * Batched file mutations (folder rename/move/delete cascades, AI build writes).
 * Mirrors the previous Firestore writeBatch with one round trip.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { inserts, updates, deletes } = await readJson<BulkBody>(req);

  if (inserts && inserts.length) {
    const { error } = await supabaseAdmin
      .from("files")
      .insert(inserts.map((f) => fileToInsert(f, user.uid)));
    if (error) return jsonError(error.message, 500);
  }

  if (updates && updates.length) {
    for (const u of updates) {
      const patch = filePatchToUpdate(u.patch);
      if (!Object.keys(patch).length) continue;
      const { error } = await supabaseAdmin
        .from("files")
        .update(patch)
        .eq("user_id", user.uid)
        .eq("id", u.id);
      if (error) return jsonError(error.message, 500);
    }
  }

  if (deletes && deletes.length) {
    const { error } = await supabaseAdmin
      .from("files")
      .delete()
      .eq("user_id", user.uid)
      .in("id", deletes);
    if (error) return jsonError(error.message, 500);
  }

  return Response.json({ ok: true });
}
