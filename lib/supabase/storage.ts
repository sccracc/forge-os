import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, supabaseConfigured } from "./server";

// Public bucket that holds generated images. Create it once in Supabase
// (see SETUP_INSTRUCTIONS_SEARCH.md). Generated-image URLs are unguessable.
const BUCKET = "generated-images";

/**
 * Downloads an image from a (temporary) source URL and re-uploads it to the
 * public `generated-images` Supabase Storage bucket, returning a permanent
 * public URL. Returns null on any failure so the caller can fall back to the
 * source URL. Never throws.
 */
export async function storeImageFromUrl(
  uid: string,
  sourceUrl: string
): Promise<string | null> {
  if (!supabaseConfigured) return null;
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) {
      console.error(`[storage] fetch source failed: ${res.status}`);
      return null;
    }
    const contentType = res.headers.get("content-type") || "image/png";
    const ext =
      contentType.includes("jpeg") || contentType.includes("jpg")
        ? "jpg"
        : contentType.includes("webp")
          ? "webp"
          : "png";
    const bytes = new Uint8Array(await res.arrayBuffer());
    const path = `${uid || "anon"}/${randomUUID()}.${ext}`;

    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) {
      console.error("[storage] upload failed:", error.message);
      return null;
    }
    const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (err) {
    console.error("[storage] storeImageFromUrl error", err);
    return null;
  }
}
