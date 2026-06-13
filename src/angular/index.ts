import { BehaviorSubject, from, type Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import type { HttpInterceptorFn } from '@angular/common/http';
import type {
  ActorClaim,
  AuthClient,
  LogoutOptions,
  Session,
  StartLoginOptions,
} from '../core/types';

export interface AngularAuthState {
  session: Session | null;
  isAuthenticated: boolean;
  isImpersonating: boolean;
  actor: ActorClaim | null;
  isLoading: boolean;
  error: unknown;
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
    destroy: () => {
      unsubscribe();
      subject.complete();
    },
  };
}
