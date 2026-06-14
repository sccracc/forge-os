"use client";

import { useComposerStore } from "@/lib/store/composer-store";
import { toast } from "@/lib/store/toast-store";
import type { AgentDoc } from "@/lib/data/types";

/**
 * Shared "use this agent" behavior for every surface that can activate an agent
 * (the Agents page, the chat composer, the Forge Code dock). Activating an agent
 * sets it as active AND adopts its defaults — model, effort, thinking, and any
 * attached skills — so a single click fully puts you "in" that persona.
 */
export function useAgentActions() {
  const activeAgentId = useComposerStore((s) => s.activeAgentId);
  const setAgent = useComposerStore((s) => s.setAgent);
  const addSkill = useComposerStore((s) => s.addSkill);
  const setModel = useComposerStore((s) => s.setModel);
  const setEffort = useComposerStore((s) => s.setEffort);
  const setThinking = useComposerStore((s) => s.setThinking);

  /** Toggle an agent on/off. Selecting the active one clears it. */
  const toggleAgent = (a: AgentDoc) => {
    if (activeAgentId === a.id) {
      setAgent(null);
      toast.success("Stopped using agent");
      return;
    }
    setAgent(a.id);
    a.skillSlugs?.forEach((slug) => addSkill(slug));
    if (a.defaultModel) setModel(a.defaultModel);
    if (a.defaultEffort) setEffort(a.defaultEffort);
    if (typeof a.defaultThinking === "boolean") setThinking(a.defaultThinking);
    toast.success(`Using agent: ${a.name}`);
  };

  const clearAgent = () => setAgent(null);

  return { activeAgentId, toggleAgent, clearAgent };
}
