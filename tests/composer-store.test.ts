import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_EFFORT } from "@/lib/ai/effort";
import { DEFAULT_MODEL } from "@/lib/ai/models.public";
import { useComposerStore } from "@/lib/store/composer-store";

function resetComposerStore() {
  useComposerStore.setState({
    model: DEFAULT_MODEL,
    effort: DEFAULT_EFFORT,
    thinking: false,
    toolsEnabled: false,
    activeSkillSlugs: [],
    incognito: false,
  });
}

afterEach(resetComposerStore);

describe("composer model selection", () => {
  it("does not change effort or thinking when changing models", () => {
    const s = useComposerStore.getState();
    s.setEffort("max");
    s.setThinking(true);

    useComposerStore.getState().setModel("spark-2.5");

    expect(useComposerStore.getState()).toMatchObject({
      model: "spark-2.5",
      effort: "max",
      thinking: true,
    });

    useComposerStore.getState().setModel("magnum-2.8");

    expect(useComposerStore.getState()).toMatchObject({
      model: "magnum-2.8",
      effort: "max",
      thinking: true,
    });
  });
});
