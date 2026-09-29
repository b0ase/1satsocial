"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NoWalletError, signIn, signOut } from "@/lib/wallet-client";

type SessionInfo = { userId: string; name: string | null; wallet: string; addresses: number } | null;

const WARNING_KEY = "ss_signin_warning";

export function shortId(id: string) {
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export function useSignIn() {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noWallet, setNoWallet] = useState(false);

  async function run() {
    setError(null);
    setNoWallet(false);
    try {
      const result = (await signIn(setStatus)) as { warning?: string } | undefined;
      if (result?.warning) {
        setError(result.warning);
        // The header swaps to the account menu after refresh; carry the notice across.
        try {
          sessionStorage.setItem(WARNING_KEY, result.warning);
        } catch {
          /* storage unavailable */
        }
      }
      router.refresh();
    } catch (e) {
      if (e instanceof NoWalletError) setNoWallet(true);
      else setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setStatus(null);
    }
  }
  return { run, status, error, noWallet };
}

export function ConnectPrompt({ label = "Connect Yours Wallet", big = false }: { label?: string; big?: boolean }) {
  const { run, status, error, noWallet } = useSignIn();
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        onClick={run}
        disabled={!!status}
        className={`rounded-full bg-gold font-medium text-black transition hover:brightness-110 disabled:opacity-60 ${big ? "px-6 py-3 text-base" : "px-4 py-1.5 text-sm"}`}
      >
        {status ?? label}
      </button>
      {noWallet && (
        <p className="text-sm text-muted">
          Yours Wallet not detected.{" "}
          <a className="text-gold underline" href="https://yours.org" target="_blank" rel="noreferrer">
            Install it
          </a>{" "}
          and refresh.
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

export function AccountButton({ session }: { session: SessionInfo }) {
  const router = useRouter();
  const { run, status } = useSignIn();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(WARNING_KEY);
    } catch {
      /* storage unavailable */
    }
    if (saved) queueMicrotask(() => setNotice(saved));
  }, []);

  function dismiss() {
    setNotice(null);
    try {
      sessionStorage.removeItem(WARNING_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  if (!session) return <ConnectPrompt />;

  return (
    <div className="relative">
      {notice && (
        <div role="status" className="fixed right-4 top-16 z-40 max-w-sm rounded-xl border border-yellow-900/70 bg-panel p-4 text-sm shadow-2xl">
          <p className="text-yellow-100/90">{notice}</p>
          <button onClick={dismiss} className="mt-2 text-xs text-muted underline hover:text-text">
            Dismiss
          </button>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-sm hover:border-gold/50"
      >
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        {session.name ?? shortId(session.userId)}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-xl border border-line bg-panel p-2 text-sm shadow-2xl">
          <p className="px-2 py-1.5 text-muted">
            {session.addresses} verified address{session.addresses === 1 ? "" : "es"} ·{" "}
            {session.wallet === "brc100" ? "Yours v5" : "Yours (legacy)"}
          </p>
          <button onClick={run} disabled={!!status} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-panel-2">
            {status ?? (session.wallet === "brc100" ? "Sign in again" : "Refresh holdings")}
          </button>
          <button
            onClick={async () => {
              await signOut();
              setOpen(false);
              router.refresh();
            }}
            className="w-full rounded-lg px-2 py-1.5 text-left text-red-300 hover:bg-panel-2"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
