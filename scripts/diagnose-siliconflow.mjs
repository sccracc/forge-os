// Deep diagnostic for SiliconFlow image generation.
//
// Answers, in ONE run:
//   1. Which image models does this API key actually expose? (exact ids)
//   2. Is `black-forest-labs/FLUX.2-pro` among them, and under what exact string?
//   3. Does FLUX.2-pro work on .com vs .cn, and with which request body / id?
//
// Run (PowerShell):
//   $env:SILICONFLOW_API_KEY="sk-..."; node scripts/diagnose-siliconflow.mjs
//
// The key is read from SILICONFLOW_API_KEY (env or .env.local) and is sent only
// to SiliconFlow. Paste the full output back.

import { readFileSync } from "node:fs";

function loadKey() {
  let key = process.env.SILICONFLOW_API_KEY?.trim();
  if (!key) {
    try {
      const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
      const line = env.split(/\r?\n/).find((l) => l.startsWith("SILICONFLOW_API_KEY="));
      if (line) key = line.slice("SILICONFLOW_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
    } catch {}
  }
  return key?.replace(/^Bearer\s+/i, "").trim();
}

const KEY = loadKey();
if (!KEY) {
  console.error("No SILICONFLOW_API_KEY found (set the env var or add it to .env.local).");
  process.exit(1);
}

const HOSTS = ["https://api.siliconflow.com", "https://api.siliconflow.cn"];
const auth = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const PROMPT = "a futuristic city at night";

// ---- 1. What image models can this key see? ---------------------------------
console.log("########## 1. MODEL LIST (image / FLUX models this key can use) ##########");
for (const host of HOSTS) {
  process.stdout.write(`\n--- GET ${host}/v1/models ---\n`);
  try {
    const res = await fetch(`${host}/v1/models?type=image`, { headers: auth });
    const text = await res.text();
    if (!res.ok) {
      // Retry without the type filter in case this host rejects it.
      const res2 = await fetch(`${host}/v1/models`, { headers: auth });
      const text2 = await res2.text();
      console.log(`type=image -> HTTP ${res.status}; plain -> HTTP ${res2.status}`);
      printModelIds(text2);
    } else {
      console.log(`HTTP ${res.status}`);
      printModelIds(text);
    }
  } catch (err) {
    console.log(`network error: ${err?.message ?? err}`);
  }
}

function printModelIds(text) {
  try {
    const json = JSON.parse(text);
    const ids = (json.data ?? json.models ?? []).map((m) => m.id ?? m).filter(Boolean);
    const flux = ids.filter((id) => /flux|image|kontext|qwen|kolors|stable/i.test(id));
    console.log(`total models: ${ids.length}`);
    console.log("image-capable / flux ids:");
    for (const id of flux) console.log(`  ${id}`);
    if (!flux.length) console.log("  (none matched — printing first 40 ids)\n  " + ids.slice(0, 40).join("\n  "));
  } catch {
    console.log("could not parse model list:", text.slice(0, 400));
  }
}

// ---- 2. Probe FLUX.2-pro: hosts x id-variants x bodies ----------------------
console.log("\n\n########## 2. FLUX.2-pro GENERATION PROBES ##########");

const MODEL = "black-forest-labs/FLUX.2-pro";
// Sweep image_size — the API ref says only model-specific presets are allowed,
// and FLUX.2's set is undocumented. `null` = omit image_size (let it default).
const SIZES = [null, "1024x1024", "1328x1328", "1536x1536", "2048x2048", "1664x928"];

for (const host of HOSTS) {
  for (const size of SIZES) {
    const body = { model: MODEL, prompt: PROMPT };
    if (size) body.image_size = size;
    process.stdout.write(`\n--- ${host} | image_size=${size ?? "(omitted)"} ---\n`);
    try {
      const res = await fetch(`${host}/v1/images/generations`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(body),
      });
      const text = await res.text();
      console.log(`HTTP ${res.status} ${res.statusText}`);
      console.log(text.slice(0, 700));
    } catch (err) {
      console.log(`network error: ${err?.message ?? err}`);
    }
  }
}

// ---- 3. Control: confirm the working model still works -----------------------
console.log("\n\n########## 3. CONTROL (Z-Image-Turbo, should be 200) ##########");
try {
  const res = await fetch(`${HOSTS[0]}/v1/images/generations`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ model: "Tongyi-MAI/Z-Image-Turbo", prompt: PROMPT, image_size: "1024x1024", batch_size: 1, num_inference_steps: 8 }),
  });
  console.log(`HTTP ${res.status}`);
  console.log((await res.text()).slice(0, 400));
} catch (err) {
  console.log(`network error: ${err?.message ?? err}`);
}
