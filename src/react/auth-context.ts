import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import type {
  AuthClient,
  LogoutOptions,
  StartLoginOptions,
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

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      auth,
      login,
      logout,
      globalLogout,
      startImpersonation,
      stopImpersonation,
    }),
    [
      state,
      auth,
      login,
      logout,
      globalLogout,
      startImpersonation,
      stopImpersonation,
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
