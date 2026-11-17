import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowUp, Eraser, MessageSquareText, Sparkles, Square, TriangleAlert } from "lucide-react";
import { useChat } from "../hooks/useChat";
import SourceCard from "./SourceCard";

function Answer({ text, sourceCount, streaming, onCite }) {
  const parts = text.split(/(\[\d+\])/g).map((part, i) => {
    const n = Number(part.match(/^\[(\d+)\]$/)?.[1]);
    if (n >= 1 && n <= sourceCount) {
      return (
        <button
          key={i}
          onClick={() => onCite(n)}
          className="mx-0.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded bg-indigo-100 px-1 align-text-top text-[10px] font-semibold text-indigo-700 transition hover:bg-indigo-200"
          title={`Show source ${n}`}>
          {n}
        </button>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
  return (
    <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-zinc-800">
      {parts}
      {streaming && (
        <span className="ml-0.5 inline-block h-4 w-[3px] translate-y-[3px] animate-blink rounded-sm bg-indigo-500" />
      )}
    </p>
  );
}

function AssistantMessage({ message }) {
  const [open, setOpen] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const streaming = message.status === "streaming";
  const { sources = [], cited = [], grounded } = message;

  //const hasEvidence = grounded && sources.length > 0;
  const primary = cited.length ? sources.filter((s) => cited.includes(s.n)) : sources;
  const visible = showAll ? sources : primary;
  //const hiddenCount = sources.length - primary.length;

  const cite = (n) => {
    setShowAll(true);
    setOpen(n);
    requestAnimationFrame(() =>
      document
        .getElementById(`source-${n}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  };

  return (
    <div className="flex animate-fade-up gap-3">
      <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 text-white shadow-sm">
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        {message.status === "error" ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p className="flex items-center gap-1.5 font-medium">
              <TriangleAlert className="h-4 w-4" />
              {message.error?.message || "Something went wrong"}
            </p>
            {message.error?.hint && <p className="mt-1 text-red-700/80">{message.error.hint}</p>}
            {message.content && (
              <p className="mt-2 whitespace-pre-wrap border-t border-red-200 pt-2 text-zinc-700">
                {message.content}
              </p>
            )}
          </div>
        ) : message.content ? (
          <Answer
            text={message.content}
            sourceCount={sources.length}
            streaming={streaming}
            onCite={cite}
          />
        ) : streaming ? (
          <div className="flex h-6 items-center gap-1" aria-label="Thinking">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 animate-dots rounded-full bg-zinc-400"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm italic text-zinc-400">Stopped.</p>
        )}

        {/* {hasEvidence && (
          <div className="mt-3 space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              {cited.length ? 'Sources' : 'Retrieved passages'} · {visible.length}
            </p>
            {visible.map((s) => (
              <SourceCard key={s.n} source={s} cited={cited.includes(s.n)} open={open === s.n} onToggle={() => setOpen(open === s.n ? null : s.n)} />
            ))}
            {!showAll && hiddenCount > 0 && (
              <button className="text-xs font-medium text-indigo-600 hover:text-indigo-500" onClick={() => setShowAll(true)}>
                Show {hiddenCount} more retrieved {hiddenCount === 1 ? 'passage' : 'passages'}
              </button>
            )}
          </div>
        )} */}

        {message.status === "done" && message.ms > 0 && (
          <p className="mt-2 text-[11px] text-zinc-400">{(message.ms / 1000).toFixed(1)}s</p>
        )}
      </div>
    </div>
  );
}

function UserMessage({ message }) {
  return (
    <div className="flex animate-fade-up justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-to-br from-blue-600 to-violet-600 px-3.5 py-2 text-[14.5px] leading-relaxed text-white shadow-sm">
        {message.content}
      </p>
    </div>
  );
}

export default function ChatPanel({
  scope,
  sessionId,
  title,
  subtitle,
  suggestions = [],
  disabledReason,
  initialQuestion,
  className = "",
  headerExtra,
}) {
  const { messages, busy, send, stop, clear } = useChat({ scope, sessionId });
  const [input, setInput] = useState("");
  const scroller = useRef(null);
  const stick = useRef(true);
  const textarea = useRef(null);
  const initialSent = useRef(false);

  useEffect(() => {
    if (initialQuestion && !initialSent.current && !disabledReason) {
      initialSent.current = true;
      send(initialQuestion);
    }
  }, [initialQuestion, disabledReason, send]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scroller.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const submit = (e) => {
    e?.preventDefault();
    if (!input.trim() || busy || disabledReason) return;
    stick.current = true;
    send(input);
    setInput("");
    if (textarea.current) textarea.current.style.height = "auto";
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  };

  const onInput = (e) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  return (
    <section
      className={`card flex min-h-0 flex-col overflow-hidden ${className}`}
      aria-label="Chat">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 text-white">
            <MessageSquareText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-zinc-900">{title}</h2>
            {subtitle && <p className="truncate text-xs text-zinc-500">{subtitle}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {headerExtra}
          {messages.length > 0 && (
            <button className="btn-icon" onClick={clear} title="Clear chat" aria-label="Clear chat">
              <Eraser className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {messages.length === 0 ? (
          <div className="flex h-full min-h-[12rem] animate-fade-in flex-col items-center justify-center text-center">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-blue-50 to-violet-100 text-indigo-600 ring-1 ring-indigo-100">
              <Sparkles className="h-5 w-5" />
            </div>
            <p className="mt-3 text-sm font-medium text-zinc-800">
              Ask anything about what was said
            </p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-zinc-500">
              Answers come only from your recordings, with the exact moments they came from. If it
              isn&apos;t in a recording, I&apos;ll say so.
            </p>
            {!disabledReason && suggestions.length > 0 && (
              <div className="mt-4 flex max-w-md flex-wrap justify-center gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-600 shadow-card transition hover:border-indigo-300 hover:text-indigo-700">
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((m) =>
            m.role === "user" ? (
              <UserMessage key={m.id} message={m} />
            ) : (
              <AssistantMessage key={m.id} message={m} />
            ),
          )
        )}
      </div>

      <form onSubmit={submit} className="p-3">
        {disabledReason && (
          <p className="mb-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
            {disabledReason}
          </p>
        )}
        <div className="flex items-end gap-2 rounded-xl border bg-white p-1.5 shadow-card transition focus-within:border-indigo-400 focus-within:ring-0 focus-within:outline-none">
          <textarea
            ref={textarea}
            value={input}
            onChange={onInput}
            onKeyDown={onKeyDown}
            rows={1}
            disabled={Boolean(disabledReason)}
            placeholder={
              sessionId ? "Ask about this recording…" : "Ask across all your conversations…"
            }
            aria-label="Your question"
            className="max-h-40 min-h-[36px] flex-1 resize-none border-none  outline-none ring-0 shadow-none focus:border-none focus:outline-none focus:ring-0 focus:shadow-none active:outline-none bg-transparent px-2 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 disabled:cursor-not-allowed"
          />
          {busy ? (
            <button
              type="button"
              onClick={stop}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zinc-900 text-white transition hover:bg-zinc-700"
              aria-label="Stop generating"
              title="Stop">
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() || Boolean(disabledReason)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 text-white transition hover:brightness-110 disabled:opacity-40"
              aria-label="Send">
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
