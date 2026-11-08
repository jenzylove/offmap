"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Live<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  at: number | null;
  reload: () => void;
}

/** Loads `fn` on mount and every `everyMs`. Keeps the last good value while refreshing. */
export function useLive<T>(fn: () => Promise<T>, deps: unknown[] = [], everyMs = 0): Live<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState<number | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const run = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const v = await fnRef.current();
      if (my !== seq.current) return;
      setData(v);
      setError(null);
      setAt(Date.now());
    } catch (e) {
      if (my !== seq.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
    if (!everyMs) return;
    const t = setInterval(() => void run(), everyMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, at, reload: run };
}
