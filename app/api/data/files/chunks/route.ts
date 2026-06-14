import { NextRequest } from "next/server";
import { requireUser, isResponse, readJson, jsonError } from "@/lib/supabase/route-helpers";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Base64 blob-chunk fallback used by FileStore when Firebase Storage (the
// primary blob backend) is unavailable. Mirrors the previous Firestore
// subcollection of chunks.

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const fileId = new URL(req.url).searchParams.get("fileId");
  if (!fileId) return jsonError("fileId required", 400);
  const { data, error } = await supabaseAdmin
    .from("file_chunks")
    .select("data")
    .eq("user_id", user.uid)
    .eq("file_id", fileId)
    .order("idx", { ascending: true });
  if (error) return jsonError(error.message, 500);
  const b64 = (data ?? []).map((r) => String(r.data)).join("");
  return Response.json({ b64 });
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const { fileId, chunks } = await readJson<{
    fileId: string;
    chunks: { idx: number; data: string }[];
  }>(req);
  if (!fileId) return jsonError("fileId required", 400);

  // Overwrite any prior chunks for this file.
  await supabaseAdmin.from("file_chunks").delete().eq("user_id", user.uid).eq("file_id", fileId);
  const rows = (chunks ?? []).map((c) => ({
    file_id: fileId,
    user_id: user.uid,
    idx: c.idx,
    data: c.data,
  }));
  if (rows.length) {
    const { error } = await supabaseAdmin.from("file_chunks").insert(rows);
    if (error) return jsonError(error.message, 500);
  }
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const fileId = new URL(req.url).searchParams.get("fileId");
  if (!fileId) return jsonError("fileId required", 400);
  const { error } = await supabaseAdmin
    .from("file_chunks")
    .delete()
    .eq("user_id", user.uid)
    .eq("file_id", fileId);
  if (error) return jsonError(error.message, 500);
  return Response.json({ ok: true });
}
