import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import type { AuthClient, StartLoginOptions } from '../core/types';
import { useAuthSession, type UseAuthSessionResult } from './use-auth-session';

export interface AuthContextValue extends UseAuthSessionResult {
  auth: AuthClient;
  login: (options?: StartLoginOptions) => Promise<void>;
  /** Clears the local session only. No server call, no redirect. */
  logout: () => Promise<void>;
  /** Clears the local session AND calls the server logout endpoint, then redirects. */
  globalLogout: (options?: { returnTo?: string }) => Promise<void>;
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
  const logout = useCallback(() => auth.logout(), [auth]);
  const globalLogout = useCallback(
    (options?: { returnTo?: string }) => auth.globalLogout(options),
    [auth],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      auth,
      login,
      logout,
      globalLogout,
    }),
    [state, auth, login, logout, globalLogout],
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
