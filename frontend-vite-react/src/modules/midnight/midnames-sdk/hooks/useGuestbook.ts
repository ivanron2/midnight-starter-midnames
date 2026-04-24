/**
 * Local-only attendance roster for the Conference Room.
 *
 * Entries live in `localStorage` on the user's browser — nothing is synced or
 * sent off-device. The on-chain counter tracks the *number* of entries
 * globally; this hook tracks *who* (by verified `.night` identity) has entered
 * from this browser so the UI can render a roster with avatars and bios.
 */
import { useCallback, useEffect, useState } from "react";

export type GuestbookEntry = {
  id: string;
  timestamp: number;
  wallet: string;
  checkInNumber: number | null;
  identity: {
    kind: "verified";
    domain: string;
    name?: string;
    bio?: string;
    avatar?: string;
    twitter?: string;
    github?: string;
    website?: string;
  };
};

const STORAGE_KEY = "midnames-workshop-guestbook-v1";

function load(): GuestbookEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensively drop any legacy anonymous entries (older builds allowed them).
    return parsed.filter(
      (e): e is GuestbookEntry => e?.identity?.kind === "verified"
    );
  } catch {
    return [];
  }
}

function save(entries: GuestbookEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage full or disabled — silently ignore
  }
}

export function useGuestbook() {
  const [entries, setEntries] = useState<GuestbookEntry[]>(() => load());

  useEffect(() => {
    save(entries);
  }, [entries]);

  const addEntry = useCallback(
    (entry: Omit<GuestbookEntry, "id" | "timestamp">) => {
      const full: GuestbookEntry = {
        ...entry,
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        timestamp: Date.now(),
      };
      setEntries((prev) => [full, ...prev]);
      return full;
    },
    []
  );

  const clear = useCallback(() => setEntries([]), []);

  return { entries, addEntry, clear };
}
