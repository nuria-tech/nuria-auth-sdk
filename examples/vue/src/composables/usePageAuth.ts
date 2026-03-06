import { useAuthSession } from '@nuria-tech/auth-sdk/vue';
import { auth } from '../auth';

export function usePageAuth() {
  return useAuthSession(auth);
}
