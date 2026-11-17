import { Link } from 'react-router-dom';
import { Mic } from 'lucide-react';
import { useStats } from '../hooks/useSessions';
import { plural } from '../lib/format';
import ChatPanel from '../components/ChatPanel';

export default function Ask() {
  const { data } = useStats();
  const empty = data && data.chunks === 0;
  //const subtitle = data ? `Searching ${plural(data.readyRecordings, 'indexed recording')} · ${plural(data.chunks, 'chunk')}` : 'Searching all recordings';

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col px-4 py-5 sm:px-8 sm:py-7">
      <div className="mb-4 animate-fade-up">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Ask AI</h1>
        <p className="mt-1 text-sm text-zinc-500">Search across everything you&apos;ve ever recorded. Every answer shows the conversation and timestamp it came from.</p>
      </div>
      <ChatPanel
        scope="global"
        title="All conversations"
        //subtitle={subtitle}
        className="min-h-[28rem] flex-1"
        disabledReason={
          empty ? (
            <>
              Nothing is indexed yet. <Link to="/record" className="inline-flex items-center gap-1 font-medium underline"><Mic className="h-3 w-3" />Record a conversation</Link> first.
            </>
          ) : undefined
        }
        suggestions={['What did we decide in my last meeting?', 'Who was assigned which tasks?', 'What deadlines were mentioned?']}
      />
    </div>
  );
}
