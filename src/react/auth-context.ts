import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import type {
  AssuranceLevel,
  AuthClient,
  LogoutOptions,
  StartLoginOptions,
  StepUpOptions,
} from '../core/types';
import { useAuthSession, type UseAuthSessionResult } from './use-auth-session';

export interface AuthContextValue extends UseAuthSessionResult {
  auth: AuthClient;
  login: (options?: StartLoginOptions) => Promise<void>;
  /**
   * Clears the local session only. No server call, no redirect.
   * Default forces re-login on the next `login()` (see `LogoutOptions.keepSso`).
   */
  logout: (options?: LogoutOptions) => Promise<void>;
  /** Clears the local session AND calls the server logout endpoint, then redirects. */
  globalLogout: (options?: { returnTo?: string }) => Promise<void>;
  /** Starts an operator impersonation session using a delegated access token. */
  startImpersonation: (accessToken: string, expiresAt: string | number) => void;
  /** Ends the impersonation session and restores the operator's own session. */
  stopImpersonation: () => Promise<void>;
  hasRole: (role: string) => boolean;
  hasGroup: (group: string) => boolean;
  stepUp: (options?: StepUpOptions) => Promise<void>;
  getAssurance: () => AssuranceLevel | null;
  satisfiesStepUp: (requiredAcr?: string, maxAgeSeconds?: number) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  auth,
  children,
}: {
  auth: AuthClient;
  children: ReactNode;
}) {
  const state = useAuthSession(auth);

  useEffect(() => {
    auth.startSilentRefresh();
    return () => {
      auth.stopSilentRefresh();
    };
  }, [auth]);

  const login = useCallback(
    (options?: StartLoginOptions) => auth.startLogin(options),
    [auth],
  );
  const logout = useCallback(
    (options?: LogoutOptions) => auth.logout(options),
    [auth],
  );
  const globalLogout = useCallback(
    (options?: { returnTo?: string }) => auth.globalLogout(options),
    [auth],
  );
  const startImpersonation = useCallback(
    (accessToken: string, expiresAt: string | number) =>
      auth.startImpersonation(accessToken, expiresAt),
    [auth],
  );
  const stopImpersonation = useCallback(() => auth.stopImpersonation(), [auth]);
  const hasRole = useCallback((role: string) => auth.hasRole(role), [auth]);
  const hasGroup = useCallback((group: string) => auth.hasGroup(group), [auth]);
  const stepUp = useCallback(
    (options?: StepUpOptions) => auth.stepUp(options),
    [auth],
  );
  const getAssurance = useCallback(() => auth.getAssurance(), [auth]);
  const satisfiesStepUp = useCallback(
    (requiredAcr?: string, maxAgeSeconds?: number) =>
      auth.satisfiesStepUp(requiredAcr, maxAgeSeconds),
    [auth],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      auth,
      login,
      logout,
      globalLogout,
      startImpersonation,
      stopImpersonation,
      hasRole,
      hasGroup,
      stepUp,
      getAssurance,
      satisfiesStepUp,
    }),
    [
      state,
      auth,
      login,
      logout,
      globalLogout,
      startImpersonation,
      stopImpersonation,
      hasRole,
      hasGroup,
      stepUp,
      getAssurance,
      satisfiesStepUp,
    ],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
