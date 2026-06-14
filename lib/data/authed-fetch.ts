"use client";

// Authenticated fetch to the Forge data API. Attaches the current Firebase ID
// token (read via the EXISTING exported getFirebaseAuth — no auth code is
// modified) so server routes can verify it and derive the uid. JSON in/out.

import { getFirebaseAuth } from "@/lib/firebase/client";

async function idToken(): Promise<string | null> {
  const user = getFirebaseAuth()?.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const token = await idToken();
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    if (j?.error) message = j.error;
    throw new ApiError(message, res.status);
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body),
  del: <T>(url: string, body?: unknown) => request<T>("DELETE", url, body),
};
