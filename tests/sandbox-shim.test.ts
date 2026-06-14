import { describe, it, expect } from "vitest";
import { injectStorageShim, STORAGE_SHIM } from "@/lib/code/sandbox-shim";

describe("injectStorageShim", () => {
  it("inserts the shim immediately after <head> so it runs before any user script", () => {
    const html = "<!doctype html><html><head><script>localStorage.getItem('x')</script></head><body></body></html>";
    const out = injectStorageShim(html);
    const shimAt = out.indexOf("forge-storage-shim");
    const userScriptAt = out.indexOf("localStorage.getItem");
    expect(shimAt).toBeGreaterThan(-1);
    expect(shimAt).toBeLessThan(userScriptAt);
  });

  it("handles a <head> with attributes", () => {
    const html = `<html><head lang="en"><title>x</title></head><body></body></html>`;
    const out = injectStorageShim(html);
    expect(out).toContain(`<head lang="en">${STORAGE_SHIM}`);
  });

  it("falls back to after <html> when there is no <head>", () => {
    const html = "<html><body><h1>hi</h1></body></html>";
    const out = injectStorageShim(html);
    expect(out.indexOf("forge-storage-shim")).toBeLessThan(out.indexOf("<body>"));
  });

  it("prepends to a bare fragment with no html/head", () => {
    const out = injectStorageShim("<div>hi</div>");
    expect(out.startsWith(STORAGE_SHIM)).toBe(true);
  });

  it("is idempotent — never injects the shim twice", () => {
    const once = injectStorageShim("<html><head></head><body></body></html>");
    const twice = injectStorageShim(once);
    expect(twice).toBe(once);
    expect(twice.match(/forge-storage-shim/g)).toHaveLength(1);
  });

  it("guards both localStorage and sessionStorage", () => {
    expect(STORAGE_SHIM).toContain("localStorage");
    expect(STORAGE_SHIM).toContain("sessionStorage");
  });
});
