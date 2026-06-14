"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { subscribeSkills } from "@/lib/data/skills";
import type { Skill } from "@/lib/data/types";

/** Favorites first, then most-recently-used, then alphabetical. */
export function orderSkills(skills: Skill[]): Skill[] {
  return [...skills].sort((a, b) => {
    if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
    const au = a.lastUsedAt ?? 0;
    const bu = b.lastUsedAt ?? 0;
    if (au !== bu) return bu - au;
    return a.name.localeCompare(b.name);
  });
}

export function useSkills() {
  const { user } = useAuth();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setSkills([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeSkills(
      user.uid,
      (s) => {
        setSkills(s);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [user]);

  return { skills, loading };
}

export function useEnabledSkills() {
  const { skills, loading } = useSkills();
  return { skills: orderSkills(skills.filter((s) => s.enabled)), loading };
}
