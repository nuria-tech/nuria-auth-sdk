import { BehaviorSubject, from, type Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import type { HttpInterceptorFn } from '@angular/common/http';
import type { AuthClient, Session, StartLoginOptions } from '../core/types';

export interface AngularAuthState {
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: unknown;
}

export interface AngularAuthFacade {
  state$: Observable<AngularAuthState>;
  snapshot: () => AngularAuthState;
  refresh: () => Promise<Session | null>;
  login: (options?: StartLoginOptions) => Promise<void>;
  /** Clears the local session only. No server call, no redirect. */
  logout: () => Promise<void>;
  /** Clears the local session AND calls the server logout endpoint, then redirects. */
  globalLogout: (options?: { returnTo?: string }) => Promise<void>;
  destroy: () => void;
}

function toState(
  session: Session | null,
  isLoading: boolean,
  error: unknown,
): AngularAuthState {
  return {
    session,
    isAuthenticated: session !== null,
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
    toState(auth.getSession(), auth.getSession() === null, null),
  );

  const unsubscribe = auth.onAuthStateChanged((nextSession) => {
    subject.next(toState(nextSession, false, null));
  });

  const refresh = async (): Promise<Session | null> => {
    subject.next(toState(subject.value.session, true, null));
    try {
      await auth.getAccessToken();
      const session = auth.getSession();
      subject.next(toState(session, false, null));
      return session;
    } catch (error) {
      subject.next(toState(auth.getSession(), false, error));
      return null;
    }
  };

  void refresh();

  return {
    state$: subject.asObservable(),
    snapshot: () => subject.value,
    refresh,
    login: (options) => auth.startLogin(options),
    logout: () => auth.logout(),
    globalLogout: (options) => auth.globalLogout(options),
    destroy: () => {
      unsubscribe();
      subject.complete();
    },
  };
}
