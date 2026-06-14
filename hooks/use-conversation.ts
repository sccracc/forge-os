"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { subscribeConversation } from "@/lib/data/chat";
import type { ConversationDoc } from "@/lib/data/types";

export function useConversation(conversationId: string | null) {
  const { user } = useAuth();
  const [conversation, setConversation] = useState<ConversationDoc | null>(null);

  useEffect(() => {
    if (!user || !conversationId) {
      setConversation(null);
      return;
    }
    return subscribeConversation(user.uid, conversationId, setConversation);
  }, [user, conversationId]);

  return conversation;
}
