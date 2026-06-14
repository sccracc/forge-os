"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { subscribeAgents } from "@/lib/data/agents";
import type { AgentDoc } from "@/lib/data/types";

export function useAgents() {
  const { user } = useAuth();
  const [agents, setAgents] = useState<AgentDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setAgents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeAgents(
      user.uid,
      (a) => {
        setAgents(a);
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [user]);

  return { agents, loading };
}
