import { afterEach, describe, expect, it, vi } from "vitest";
import { searchWeb } from "@/lib/search";

const originalSerper = process.env.SERPER_API_KEY;
const originalBrave = process.env.BRAVE_SEARCH_API_KEY;

describe("search provider routing", () => {
  afterEach(() => {
    process.env.SERPER_API_KEY = originalSerper;
    process.env.BRAVE_SEARCH_API_KEY = originalBrave;
    vi.unstubAllGlobals();
  });

  it("uses Serper first and normalizes organic results", async () => {
    process.env.SERPER_API_KEY = "serper-test-key";
    delete process.env.BRAVE_SEARCH_API_KEY;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            organic: [
              {
                title: "Forge OS",
                link: "https://example.com/forge",
                snippet: "Forge search result.",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    await expect(searchWeb("forge os", 3)).resolves.toEqual([
      {
        title: "Forge OS",
        url: "https://example.com/forge",
        description: "Forge search result.",
      },
    ]);

    expect(fetch).toHaveBeenCalledWith(
      "https://google.serper.dev/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-API-KEY": "serper-test-key",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ q: "forge os", num: 3, gl: "us", hl: "en" }),
      })
    );
  });
});
