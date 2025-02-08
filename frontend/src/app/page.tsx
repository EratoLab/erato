'use client';

import { Chat } from '../components/ui/Chat';
import { ChatProvider } from '../components/containers/ChatProvider';

export default function Home() {
  return (
    <div className="min-h-screen bg-theme-bg-primary">
      <ChatProvider>
        <main className="container mx-auto h-screen p-4">
          <Chat 
            layout="default"
            showAvatars={true}
            showTimestamps={true}
            onCopyMessage={(messageId) => console.log('Copy message:', messageId)}
            onLikeMessage={(messageId) => console.log('Like message:', messageId)}
            onDislikeMessage={(messageId) => console.log('Dislike message:', messageId)}
            onRerunMessage={(messageId) => console.log('Rerun message:', messageId)}
            onNewChat={() => console.log('New chat')}
            onRegenerate={() => console.log('Regenerate')}
          />
        </main>
      </ChatProvider>
    </div>
  );
}
