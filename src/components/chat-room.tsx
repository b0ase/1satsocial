"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Message } from "@/lib/store";

const POLL_MS = 2500;

function shortId(id: string) {
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function hue(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatRoom({ apiBase, initial, me }: { apiBase: string; initial: Message[]; me: string }) {
  const router = useRouter();
  const [messages, setMessages] = useState(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const lastId = useRef(initial.at(-1)?.id ?? 0);

  function merge(incoming: Message[]) {
    if (!incoming.length) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const next = [...prev, ...incoming.filter((m) => !seen.has(m.id))];
      lastId.current = Math.max(lastId.current, ...incoming.map((m) => m.id));
      return next;
    });
  }

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      const res = await fetch(`${apiBase}?after=${lastId.current}`).catch(() => null);
      if (stop || !res) return;
      if (res.status === 403 || res.status === 401) return setLost(true);
      if (res.ok) merge((await res.json()).messages);
    };
    const t = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [apiBase]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    const res = await fetch(apiBase, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    }).catch(() => null);
    setSending(false);
    if (!res) return setError("Network error");
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 403) setLost(true);
      return setError(data.error);
    }
    setDraft("");
    merge([data.message]);
  }

  if (lost) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-line bg-panel p-10 text-center">
        <h2 className="text-lg font-medium">You no longer hold this token</h2>
        <p className="mt-2 text-muted">Access follows the token.</p>
        <button onClick={() => router.refresh()} className="mt-4 rounded-full border border-line px-4 py-1.5 text-sm">
          Re-check
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="flex-1 space-y-1 overflow-y-auto p-4" style={{ maxHeight: "calc(100vh - 260px)" }}>
        {messages.length === 0 && (
          <p className="py-20 text-center text-muted">No messages yet. You&apos;re early. Say gm.</p>
        )}
        {messages.map((m, i) => {
          const mine = m.userId === me;
          const grouped = i > 0 && messages[i - 1].userId === m.userId;
          return (
            <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"} ${grouped ? "" : "pt-3"}`}>
              {!grouped && (
                <div className="mb-1 flex items-center gap-2 px-1 text-xs text-muted">
                  <span className="font-medium" style={{ color: mine ? "var(--gold)" : `hsl(${hue(m.userId)} 60% 70%)` }}>
                    {mine ? "You" : (m.name ?? shortId(m.userId))}
                  </span>
                  <span>{time(m.createdAt)}</span>
                </div>
              )}
              <div
                className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed ${
                  mine ? "bg-gold text-black" : "bg-panel-2"
                }`}
              >
                {m.body}
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="border-t border-line p-3">
        {error && <p className="mb-2 px-1 text-sm text-red-400">{error}</p>}
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={1000}
            placeholder="Message holders…"
            className="min-w-0 flex-1 rounded-full border border-line bg-panel-2 px-4 py-2.5 outline-none placeholder:text-muted focus:border-gold/60"
          />
          <button
            disabled={sending || !draft.trim()}
            className="rounded-full bg-gold px-5 font-medium text-black transition hover:brightness-110 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
