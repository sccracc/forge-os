import { ChatTopbar } from "@/components/shell/topbar";
import { ChatView } from "@/components/chat/chat-view";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <ChatTopbar conversationId={id} />
      <div className="content-area">
        <ChatView conversationId={id} />
      </div>
    </>
  );
}
