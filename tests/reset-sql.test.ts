import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(join(process.cwd(), "supabase", "schema.sql"), "utf8");

describe("Supabase usage reset SQL", () => {
  it("sets free daily resets to midnight UTC explicitly", () => {
    expect(schema).toContain("date_trunc('day', v_now at time zone 'UTC')");
  });

  it("sets monthly usage resets to the first day of next month in UTC", () => {
    expect(schema).toContain("date_trunc('month', now() at time zone 'UTC')");
    expect(schema).toContain("date_trunc('month', v_now at time zone 'UTC')");
  });
});
