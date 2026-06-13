import { inject, provide } from 'vue';
import type { AuthClient } from '../core/types';

const AUTH_KEY = Symbol('nuria-auth');

export function provideAuth(auth: AuthClient): void {
  provide(AUTH_KEY, auth);
}

export function useAuth(): AuthClient {
  const auth = inject<AuthClient>(AUTH_KEY);
  if (!auth)
    throw new Error(
      '[nuria-auth] useAuth() must be called inside a component tree where provideAuth() was called.',
    );
  return auth;
}
