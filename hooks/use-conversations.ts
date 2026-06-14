"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { subscribeConversations } from "@/lib/data/chat";
import type { ConversationDoc } from "@/lib/data/types";

export function useConversations() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ConversationDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setConversations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeConversations(
      user.uid,
      (c) => {
        setConversations(c);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [user]);

  return { conversations, loading };
}
