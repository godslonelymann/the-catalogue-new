import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useApi } from "../api/ApiContext";
import { isApiError } from "../api/client";
import type { Account } from "../api/types";

interface AuthValue {
  account: Account | null;
  loading: boolean;
  setAccount(account: Account | null): void;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setAccount(await api.me());
    } catch (error) {
      if (!isApiError(error, "unauthenticated")) console.error(error);
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ account, loading, setAccount, refresh }), [account, loading, refresh]);
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthValue {
  const value = use(AuthContext);
  if (!value) throw new Error("useAuth needs an AuthProvider.");
  return value;
}
