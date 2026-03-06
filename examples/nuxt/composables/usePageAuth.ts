import { useAuthSession } from '@nuria-tech/auth-sdk/vue';
import { useAuthClient } from './useAuthClient';

export function usePageAuth() {
  const auth = useAuthClient();
  return { auth, ...useAuthSession(auth) };
}
