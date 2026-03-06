import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from 'react';
import type { AuthClient } from '../core/types';
import { useAuthSession, type UseAuthSessionResult } from './use-auth-session';

export interface AuthContextValue extends UseAuthSessionResult {
  auth: AuthClient;
  login: () => Promise<void>;
  logout: (options?: { returnTo?: string }) => Promise<void>;
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

  const value: AuthContextValue = {
    ...state,
    auth,
    login: () => auth.startLogin(),
    logout: (options) => auth.logout(options),
  };

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
