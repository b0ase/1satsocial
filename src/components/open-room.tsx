"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { resolveRoomInput, roomPath } from "@/lib/room-ref";

export function OpenRoom() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const room = resolveRoomInput(value);
        if (!room) return setError("Paste a BSV-21 token id, a BSV-20 tick, or a collection id / 1sat.market link.");
        router.push(roomPath(room));
      }}
      className="flex flex-col gap-2"
    >
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          placeholder="Token id, $TICK, or collection link"
          className="min-w-0 flex-1 rounded-full border border-line bg-panel-2 px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-gold/60"
        />
        <button className="rounded-full border border-gold/60 px-4 text-sm text-gold hover:bg-gold-soft">Open</button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
