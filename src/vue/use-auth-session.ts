import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue';
import type { AuthClient, Session } from '../core/types';

export interface UseVueAuthSessionResult {
  session: Ref<Session | null>;
  isAuthenticated: Readonly<Ref<boolean>>;
  isLoading: Ref<boolean>;
  error: Ref<unknown>;
  refresh: () => Promise<Session | null>;
}

export function useAuthSession(auth: AuthClient): UseVueAuthSessionResult {
  const session = ref<Session | null>(auth.getSession());
  const isLoading = ref<boolean>(session.value === null);
  const error = ref<unknown>(null);
  let unsubscribe: (() => void) | null = null;

  const hydrate = async () => {
    try {
      await auth.getAccessToken();
      session.value = auth.getSession();
    } catch (err) {
      error.value = err;
    } finally {
      isLoading.value = false;
    }
  };

  onMounted(() => {
    unsubscribe = auth.onAuthStateChanged((nextSession) => {
      session.value = nextSession;
      isLoading.value = false;
    });
    void hydrate();
  });

  onUnmounted(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  const refresh = async () => {
    try {
      await auth.getAccessToken();
      const nextSession = auth.getSession();
      session.value = nextSession;
      error.value = null;
      return nextSession;
    } catch (err) {
      error.value = err;
      return null;
    } finally {
      isLoading.value = false;
    }
  };

  return {
    session,
    isAuthenticated: computed(() => session.value !== null),
    isLoading,
    error,
    refresh,
  };
}
