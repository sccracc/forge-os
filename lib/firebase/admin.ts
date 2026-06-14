import "server-only";
import {
  cert,
  getApps,
  initializeApp,
  getApp,
  type App,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getStorage, type Storage } from "firebase-admin/storage";

const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
// Private keys are stored with literal "\n" in env; restore real newlines.
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

export const adminConfigured = Boolean(projectId && clientEmail && privateKey);

let app: App | null = null;

export function getAdminApp(): App | null {
  if (!adminConfigured) return null;
  if (app) return app;
  app = getApps().length
    ? getApp()
    : initializeApp({
        credential: cert({
          projectId: projectId!,
          clientEmail: clientEmail!,
          privateKey: privateKey!,
        }),
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      });
  return app;
}

export function getAdminAuth(): Auth | null {
  const a = getAdminApp();
  return a ? getAuth(a) : null;
}

export function getAdminStorage(): Storage | null {
  const a = getAdminApp();
  return a ? getStorage(a) : null;
}
