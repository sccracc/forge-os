import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateImage,
  imageModelForPlan,
  siliconFlowApiKey,
  SILICONFLOW_IMAGE_EDIT_MODEL,
  SILICONFLOW_TEXT_IMAGE_MAX_ULTRA_MODEL,
  SILICONFLOW_TEXT_IMAGE_STARTER_PRO_MODEL,
} from "@/lib/images/siliconflow";
import { executeGenerateImage } from "@/lib/ai/tools";

const originalApiKey = process.env.SILICONFLOW_API_KEY;

function mockImageResponse(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })
    )
  );
}

describe("SiliconFlow image generation", () => {
  beforeEach(() => {
    process.env.SILICONFLOW_API_KEY = "sf-test-key";
  });

  afterEach(() => {
    process.env.SILICONFLOW_API_KEY = originalApiKey;
    vi.unstubAllGlobals();
  });

  it.each([
    [{ images: [{ url: "https://img.example/images-shape.png" }] }, "https://img.example/images-shape.png"],
    [{ data: [{ url: "https://img.example/data-shape.png" }] }, "https://img.example/data-shape.png"],
    [{ url: "https://img.example/root-shape.png" }, "https://img.example/root-shape.png"],
  ])("returns the first image URL from supported response shapes", async (body, expected) => {
    mockImageResponse(body);

    await expect(generateImage("a brass city at dusk")).resolves.toEqual({
      url: expected,
      fellBack: false,
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.siliconflow.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sf-test-key",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          model: SILICONFLOW_TEXT_IMAGE_STARTER_PRO_MODEL,
          prompt: "a brass city at dusk",
          image_size: "1024x1024",
          batch_size: 1,
          num_inference_steps: 8,
        }),
      })
    );
  });

  it("routes Max and Ultra text generation to Flux.2 Pro", () => {
    expect(imageModelForPlan("max", "generate")).toBe(SILICONFLOW_TEXT_IMAGE_MAX_ULTRA_MODEL);
    expect(imageModelForPlan("ultra", "generate")).toBe(SILICONFLOW_TEXT_IMAGE_MAX_ULTRA_MODEL);
  });

  it("omits batch_size for Flux.2 Pro (Max/Ultra) — SiliconFlow 500s on it", async () => {
    mockImageResponse({ images: [{ url: "https://img.example/flux.png" }] });

    await expect(generateImage("a brass city at dusk", { plan: "max" })).resolves.toEqual({
      url: "https://img.example/flux.png",
      fellBack: false,
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.siliconflow.com/v1/images/generations",
      expect.objectContaining({
        body: JSON.stringify({
          model: SILICONFLOW_TEXT_IMAGE_MAX_ULTRA_MODEL,
          prompt: "a brass city at dusk",
          image_size: "1024x1024",
        }),
      })
    );
  });

  it("falls back to Z-Image-Turbo when Flux.2 Pro is unavailable (Max/Ultra)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: "Request failed: Unknown error" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ images: [{ url: "https://img.example/fallback.png" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        )
    );

    await expect(generateImage("a picture of a dog", { plan: "ultra" })).resolves.toEqual({
      url: "https://img.example/fallback.png",
      fellBack: true,
    });

    // First call hits Flux.2 Pro (500), second retries with Z-Image-Turbo.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.siliconflow.com/v1/images/generations",
      expect.objectContaining({
        body: JSON.stringify({
          model: SILICONFLOW_TEXT_IMAGE_MAX_ULTRA_MODEL,
          prompt: "a picture of a dog",
          image_size: "1024x1024",
        }),
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://api.siliconflow.com/v1/images/generations",
      expect.objectContaining({
        body: JSON.stringify({
          model: SILICONFLOW_TEXT_IMAGE_STARTER_PRO_MODEL,
          prompt: "a picture of a dog",
          image_size: "1024x1024",
          batch_size: 1,
          num_inference_steps: 8,
        }),
      })
    );
  });

  it("does not fall back for failed edits (Z-Image-Turbo can't edit)", async () => {
    mockImageResponse({ message: "Request failed: Unknown error" }, 500);

    await expect(
      generateImage("make the jacket red", {
        plan: "ultra",
        mode: "edit",
        inputImageBase64: "ZmFrZQ==",
        inputMimeType: "image/png",
      })
    ).rejects.toThrow(/temporarily unavailable/i);

    // Edit failure must not silently retry as a text-to-image generation.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("executeGenerateImage half-counts a fallback and attaches an apology notice", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: "Request failed: Unknown error" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ images: [{ url: "https://img.example/fb.png" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        )
    );

    const result = await executeGenerateImage(
      { prompt: "a picture of a dog", loading_text: "Generating your dog..." },
      { plan: "ultra" }
    );

    expect(result.count).toBe(0.5);
    expect(result.image?.imageUrl).toBe("https://img.example/fb.png");
    expect(result.image?.notice).toMatch(/half an image/i);
    // The notice must not name the real provider (provider-secrecy invariant).
    expect(result.image?.notice).not.toMatch(/siliconflow|flux|z-image/i);
    expect(JSON.parse(result.content).notice).toMatch(/half an image/i);
  });

  it("executeGenerateImage counts a normal image as 1 with no notice", async () => {
    mockImageResponse({ images: [{ url: "https://img.example/ok.png" }] });

    const result = await executeGenerateImage(
      { prompt: "a picture of a dog", loading_text: "Generating your dog..." },
      { plan: "starter" }
    );

    expect(result.count).toBe(1);
    expect(result.image?.notice).toBeUndefined();
  });

  it("routes attached-image edits to Flux.1 Kontext Dev", async () => {
    mockImageResponse({ images: [{ url: "https://img.example/edit.png" }] });

    await expect(
      generateImage("make the jacket red", {
        plan: "pro",
        mode: "edit",
        inputImageBase64: "ZmFrZQ==",
        inputMimeType: "image/png",
      })
    ).resolves.toEqual({ url: "https://img.example/edit.png", fellBack: false });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.siliconflow.com/v1/images/generations",
      expect.objectContaining({
        body: JSON.stringify({
          model: SILICONFLOW_IMAGE_EDIT_MODEL,
          prompt: "make the jacket red",
          image_size: "1024x1024",
          image: "data:image/png;base64,ZmFrZQ==",
        }),
      })
    );
  });

  it("throws a clean error when the API key is missing", async () => {
    delete process.env.SILICONFLOW_API_KEY;

    await expect(generateImage("a city")).rejects.toThrow("Image generation is not configured.");
  });

  it("throws a provider-free error when the upstream rejects the key", async () => {
    mockImageResponse({ error: { message: "Unauthorized" } }, 401);

    const err = await generateImage("a city").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(
      "Image generation isn't fully configured on this deployment."
    );
    // Provider-secrecy invariant: client-visible errors never name the vendor.
    expect((err as Error).message).not.toMatch(/siliconflow|flux|z-image/i);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to the China API host if the global host rejects the key", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ message: "Invalid token" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ images: [{ url: "https://img.example/cn.png" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        )
    );

    await expect(generateImage("a city")).resolves.toEqual({
      url: "https://img.example/cn.png",
      fellBack: false,
    });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.siliconflow.com/v1/images/generations",
      expect.any(Object)
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://api.siliconflow.cn/v1/images/generations",
      expect.any(Object)
    );
  });

  it("accepts an API key accidentally pasted with a Bearer prefix", async () => {
    process.env.SILICONFLOW_API_KEY = "Bearer sf-test-key";
    mockImageResponse({ url: "https://img.example/prefix.png" });

    await expect(generateImage("a city")).resolves.toEqual({
      url: "https://img.example/prefix.png",
      fellBack: false,
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sf-test-key" }),
      })
    );
  });

  it.each([
    ["'sf-test-key'", "sf-test-key"],
    ['"sf-test-key"', "sf-test-key"],
    ["SILICONFLOW_API_KEY=sf-test-key", "sf-test-key"],
    ['SILICONFLOW_API_KEY="sf-test-key"', "sf-test-key"],
    ["Bearer sf-test-key", "sf-test-key"],
    ['Bearer "sf-test-key"', "sf-test-key"],
  ])("normalizes Vercel env value format %s", (raw, expected) => {
    process.env.SILICONFLOW_API_KEY = raw;

    expect(siliconFlowApiKey()).toBe(expected);
  });

  it("returns a tool error instead of throwing when image generation is not configured", async () => {
    delete process.env.SILICONFLOW_API_KEY;

    const result = await executeGenerateImage({
      prompt: "a futuristic city at night",
      loading_text: "Generating your futuristic city at night...",
    });

    expect(JSON.parse(result.content)).toEqual({ error: "Image generation is not configured." });
    expect(result.image).toEqual({
      loadingText: "Generating your futuristic city at night...",
      error: "Image generation is not configured.",
    });
  });
});
