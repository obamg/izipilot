import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getBootstrap, type Bootstrap, ApiError } from "./api";
import { useAuth } from "./auth-context";

// One fetch shared by every tab, with pull-to-refresh. A 401 that survives
// the client's automatic token refresh means the session is gone → sign out.

interface BootstrapContextValue {
  data: Bootstrap | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const BootstrapContext = createContext<BootstrapContextValue | null>(null);

export function BootstrapProvider({ children }: { children: React.ReactNode }) {
  const { status, signOut } = useAuth();
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const fresh = await getBootstrap();
      setData(fresh);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await signOut();
        return;
      }
      setError(err instanceof ApiError ? err.message : "Impossible de charger les données. Vérifiez votre connexion.");
    } finally {
      setLoading(false);
    }
  }, [signOut]);

  useEffect(() => {
    if (status === "signedIn") {
      setLoading(true);
      refresh();
    } else {
      setData(null);
    }
  }, [status, refresh]);

  return (
    <BootstrapContext.Provider value={{ data, loading, error, refresh }}>
      {children}
    </BootstrapContext.Provider>
  );
}

export function useBootstrap(): BootstrapContextValue {
  const ctx = useContext(BootstrapContext);
  if (!ctx) throw new Error("useBootstrap must be used within BootstrapProvider");
  return ctx;
}
