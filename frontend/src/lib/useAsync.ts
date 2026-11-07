import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload(): Promise<void>;
  setData(data: T): void;
}

/**
 * Runs `load` when `key` changes and keeps the latest result.
 * A reload keeps the old data on screen until the new data arrives.
 */
export function useAsync<T>(load: () => Promise<T>, key: string): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });

  const run = useCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    try {
      const result = await loader.current();
      if (request === latest.current) {
        setData(result);
        setError(null);
      }
    } catch (failure) {
      if (request === latest.current) setError(failure);
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [key, run]);

  return { data, error, loading, reload: run, setData };
}
