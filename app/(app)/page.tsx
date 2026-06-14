import { ChatTopbar } from "@/components/shell/topbar";
import { ChatView } from "@/components/chat/chat-view";

export default function ChatHomePage() {
  return (
    <>
      <ChatTopbar conversationId={null} />
      <div className="content-area">
        <ChatView conversationId={null} />
      </div>
    </>
  );
}
