import { useCallback, useEffect, useState } from 'react';
import type { AuthClient, Session } from '../core/types';

export interface UseAuthSessionResult {
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<Session | null>;
}

export function useAuthSession(auth: AuthClient): UseAuthSessionResult {
  const [session, setSession] = useState<Session | null>(() =>
    auth.getSession(),
  );
  const [isLoading, setIsLoading] = useState<boolean>(
    () => auth.getSession() === null,
  );
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = auth.onAuthStateChanged((nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setIsLoading(false);
    });

    const hydrate = async () => {
      try {
        await auth.getAccessToken();
        if (!mounted) return;
        setSession(auth.getSession());
      } catch (err) {
        if (!mounted) return;
        setError(err);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void hydrate();
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [auth]);

  const refresh = useCallback(async () => {
    try {
      await auth.getAccessToken();
      const nextSession = auth.getSession();
      setSession(nextSession);
      setError(null);
      return nextSession;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [auth]);

  return {
    session,
    isAuthenticated: session !== null,
    isLoading,
    error,
    refresh,
  };
}
