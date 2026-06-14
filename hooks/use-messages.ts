"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { subscribeMessages } from "@/lib/data/chat";
import type { MessageDoc } from "@/lib/data/types";

export function useMessages(conversationId: string | null) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<MessageDoc[]>([]);
  const [loading, setLoading] = useState(Boolean(conversationId));

  useEffect(() => {
    if (!user || !conversationId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeMessages(user.uid, conversationId, (m) => {
      setMessages(m);
      setLoading(false);
    });
    return unsub;
  }, [user, conversationId]);

  return { messages, loading };
}
