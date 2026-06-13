import { BehaviorSubject, from, type Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import type { HttpInterceptorFn } from '@angular/common/http';
import type {
  ActorClaim,
  AssuranceLevel,
  AuthClient,
  LogoutOptions,
  Session,
  StartLoginOptions,
  StepUpOptions,
} from '../core/types';

export interface AngularAuthState {
  session: Session | null;
  isAuthenticated: boolean;
  isImpersonating: boolean;
  actor: ActorClaim | null;
  isLoading: boolean;
  error: unknown;
  hasRole: (role: string) => boolean;
  hasGroup: (group: string) => boolean;
}

export interface AngularAuthFacade {
  state$: Observable<AngularAuthState>;
  snapshot: () => AngularAuthState;
  refresh: () => Promise<Session | null>;
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
  stepUp: (options?: StepUpOptions) => Promise<void>;
  getAssurance: () => AssuranceLevel | null;
  satisfiesStepUp: (requiredAcr?: string, maxAgeSeconds?: number) => boolean;
  destroy: () => void;
}

function toState(
  auth: AuthClient,
  session: Session | null,
  isLoading: boolean,
  error: unknown,
): AngularAuthState {
  return {
    session,
    isAuthenticated: session !== null,
    isImpersonating: auth.isImpersonating(),
    actor: auth.getActor(),
    isLoading,
    error,
    hasRole: (role: string) => auth.hasRole(role),
    hasGroup: (group: string) => auth.hasGroup(group),
  };
}

export function createBearerInterceptor(auth: AuthClient): HttpInterceptorFn {
  return (req, next) =>
    from(auth.getAccessToken()).pipe(
      switchMap((token) => {
        if (!token) return next(req);
        return next(
          req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }),
        );
      }),
    );
}

export function createAngularAuthFacade(auth: AuthClient): AngularAuthFacade {
  const subject = new BehaviorSubject<AngularAuthState>(
    toState(auth, auth.getSession(), auth.getSession() === null, null),
  );

  const unsubscribe = auth.onAuthStateChanged((nextSession) => {
    subject.next(toState(auth, nextSession, false, null));
  });

  auth.startSilentRefresh();

  const refresh = async (): Promise<Session | null> => {
    subject.next({ ...subject.value, isLoading: true });
    try {
      await auth.getAccessToken();
      const session = auth.getSession();
      subject.next(toState(auth, session, false, null));
      return session;
    } catch (error) {
      subject.next(toState(auth, auth.getSession(), false, error));
      return null;
    }
  };

  void refresh();

  return {
    state$: subject.asObservable(),
    snapshot: () => subject.value,
    refresh,
    login: (options) => auth.startLogin(options),
    logout: (options) => auth.logout(options),
    globalLogout: (options) => auth.globalLogout(options),
    startImpersonation: (accessToken, expiresAt) =>
      auth.startImpersonation(accessToken, expiresAt),
    stopImpersonation: () => auth.stopImpersonation(),
    stepUp: (options) => auth.stepUp(options),
    getAssurance: () => auth.getAssurance(),
    satisfiesStepUp: (requiredAcr, maxAgeSeconds) =>
      auth.satisfiesStepUp(requiredAcr, maxAgeSeconds),
    destroy: () => {
      auth.stopSilentRefresh();
      unsubscribe();
      subject.complete();
    },
  };
}

import {
  mountImpersonationBanner as _mountVue,
  type MountImpersonationBannerOptions,
} from '../vue/ImpersonationBanner';

export type { MountImpersonationBannerOptions };

/**
 * Mounts the impersonation banner as a standalone Vue app appended to
 * `document.body`. Angular portals are DOM-based so the Vue DOM mount works
 * without an Ivy component context.
 */
export function mountImpersonationBanner(
  auth: AuthClient,
  options?: MountImpersonationBannerOptions,
): () => void {
  return _mountVue(auth, options);
}
