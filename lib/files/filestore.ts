"use client";

import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { getStorageClient, firebaseConfigured } from "@/lib/firebase/client";
import { api } from "@/lib/data/authed-fetch";

const CHUNK_SIZE = 600 * 1024; // ~600KB base64 per chunk.

export interface StoredBlobRef {
  storagePath?: string;
  chunked?: boolean;
}

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

function fromBase64(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Single FileStore for binary/large blobs. Primary backend is Firebase Storage
 * (UNCHANGED); if Storage is unavailable it transparently falls back to base64
 * chunks stored in Supabase (`file_chunks`). Auto-detected per write.
 */
export const FileStore = {
  async put(uid: string, fileId: string, blob: Blob): Promise<StoredBlobRef> {
    const storage = getStorageClient();
    if (storage) {
      try {
        const path = `users/${uid}/files/${fileId}`;
        await uploadBytes(ref(storage, path), blob, { contentType: blob.type });
        return { storagePath: path };
        // FORGE-NOTE: active backend = Firebase Storage.
      } catch {
        // fall through to the Supabase chunk fallback
      }
    }
    // FORGE-NOTE: active backend = Supabase base64 chunks (Storage unavailable).
    const b64 = await toBase64(blob);
    const chunks: { idx: number; data: string }[] = [];
    let idx = 0;
    for (let i = 0; i < b64.length; i += CHUNK_SIZE) {
      chunks.push({ idx, data: b64.slice(i, i + CHUNK_SIZE) });
      idx++;
    }
    await api.post("/api/data/files/chunks", { fileId, chunks });
    return { chunked: true };
  },

  async getUrl(
    uid: string,
    fileId: string,
    refData: StoredBlobRef,
    mime = "application/octet-stream"
  ): Promise<string | null> {
    if (refData.storagePath) {
      const storage = getStorageClient();
      if (!storage) return null;
      return getDownloadURL(ref(storage, refData.storagePath));
    }
    if (refData.chunked) {
      const { b64 } = await api.get<{ b64: string }>(
        `/api/data/files/chunks?fileId=${encodeURIComponent(fileId)}`
      );
      return URL.createObjectURL(fromBase64(b64, mime));
    }
    return null;
  },

  async remove(uid: string, fileId: string, refData: StoredBlobRef): Promise<void> {
    if (refData.storagePath) {
      const storage = getStorageClient();
      if (storage) await deleteObject(ref(storage, refData.storagePath)).catch(() => {});
    }
    if (refData.chunked) {
      await api
        .del(`/api/data/files/chunks?fileId=${encodeURIComponent(fileId)}`)
        .catch(() => {});
    }
  },
};

export const storageReady = firebaseConfigured;
