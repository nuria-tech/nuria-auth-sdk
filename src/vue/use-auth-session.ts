import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue';
import type {
  ActorClaim,
  AssuranceLevel,
  AuthClient,
  Session,
  StepUpOptions,
} from '../core/types';

export interface UseVueAuthSessionResult {
  session: Ref<Session | null>;
  isAuthenticated: Readonly<Ref<boolean>>;
  isImpersonating: Ref<boolean>;
  actor: Ref<ActorClaim | null>;
  isLoading: Ref<boolean>;
  error: Ref<unknown>;
  refresh: () => Promise<Session | null>;
  hasRole: (role: string) => boolean;
  hasGroup: (group: string) => boolean;
  getAssurance: () => AssuranceLevel | null;
  satisfiesStepUp: (requiredAcr?: string, maxAgeSeconds?: number) => boolean;
  stepUp: (options?: StepUpOptions) => Promise<void>;
}

export function useAuthSession(auth: AuthClient): UseVueAuthSessionResult {
  const session = ref<Session | null>(auth.getSession());
  const isLoading = ref<boolean>(session.value === null);
  const error = ref<unknown>(null);
  const isImpersonating = ref<boolean>(auth.isImpersonating());
  const actor = ref<ActorClaim | null>(auth.getActor());
  let unsubscribe: (() => void) | null = null;

  const hydrate = async () => {
    try {
      await auth.getAccessToken();
      session.value = auth.getSession();
      isImpersonating.value = auth.isImpersonating();
      actor.value = auth.getActor();
      error.value = null;
    } catch (err) {
      error.value = err;
    } finally {
      isLoading.value = false;
    }
  };

  onMounted(() => {
    unsubscribe = auth.onAuthStateChanged((nextSession) => {
      session.value = nextSession;
      isImpersonating.value = auth.isImpersonating();
      actor.value = auth.getActor();
      isLoading.value = false;
    });
    auth.startSilentRefresh();
    void hydrate();
  });

  onUnmounted(() => {
    unsubscribe?.();
    unsubscribe = null;
    auth.stopSilentRefresh();
  });

  const refresh = async () => {
    try {
      await auth.getAccessToken();
      const nextSession = auth.getSession();
      session.value = nextSession;
      isImpersonating.value = auth.isImpersonating();
      actor.value = auth.getActor();
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
    isImpersonating,
    actor,
    isLoading,
    error,
    refresh,
    hasRole: (role: string) => auth.hasRole(role),
    hasGroup: (group: string) => auth.hasGroup(group),
    getAssurance: () => auth.getAssurance(),
    satisfiesStepUp: (requiredAcr?: string, maxAgeSeconds?: number) =>
      auth.satisfiesStepUp(requiredAcr, maxAgeSeconds),
    stepUp: (options?: StepUpOptions) => auth.stepUp(options),
  };
}
