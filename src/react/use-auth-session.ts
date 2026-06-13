import { useCallback, useEffect, useState } from 'react';
import type {
  ActorClaim,
  AssuranceLevel,
  AuthClient,
  Session,
} from '../core/types';

export interface UseAuthSessionResult {
  session: Session | null;
  isAuthenticated: boolean;
  isImpersonating: boolean;
  actor: ActorClaim | null;
  isLoading: boolean;
  error: unknown;
  refresh: () => Promise<Session | null>;
  hasRole: (role: string) => boolean;
  hasGroup: (group: string) => boolean;
  getAssurance: () => AssuranceLevel | null;
  satisfiesStepUp: (requiredAcr?: string, maxAgeSeconds?: number) => boolean;
}

export function useAuthSession(auth: AuthClient): UseAuthSessionResult {
  const [session, setSession] = useState<Session | null>(() =>
    auth.getSession(),
  );
  const [isImpersonating, setIsImpersonating] = useState<boolean>(() =>
    auth.isImpersonating(),
  );
  const [actor, setActor] = useState<ActorClaim | null>(() => auth.getActor());
  const [isLoading, setIsLoading] = useState<boolean>(
    () => auth.getSession() === null,
  );
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = auth.onAuthStateChanged((nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setIsImpersonating(auth.isImpersonating());
      setActor(auth.getActor());
      setIsLoading(false);
    });

    const hydrate = async () => {
      try {
        await auth.getAccessToken();
        if (!mounted) return;
        setSession(auth.getSession());
        setIsImpersonating(auth.isImpersonating());
        setActor(auth.getActor());
        setError(null);
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

  const hasRole = useCallback((role: string) => auth.hasRole(role), [auth]);
  const hasGroup = useCallback((group: string) => auth.hasGroup(group), [auth]);
  const getAssurance = useCallback(() => auth.getAssurance(), [auth]);
  const satisfiesStepUp = useCallback(
    (requiredAcr?: string, maxAgeSeconds?: number) =>
      auth.satisfiesStepUp(requiredAcr, maxAgeSeconds),
    [auth],
  );

  return {
    session,
    isAuthenticated: session !== null,
    isImpersonating,
    actor,
    isLoading,
    error,
    refresh,
    hasRole,
    hasGroup,
    getAssurance,
    satisfiesStepUp,
  };
}
