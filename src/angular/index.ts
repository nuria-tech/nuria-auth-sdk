import { BehaviorSubject, type Observable } from 'rxjs';
import type { AuthClient, Session } from '../core/types';

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
  login: () => Promise<void>;
  logout: (options?: { returnTo?: string }) => Promise<void>;
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
    login: () => auth.startLogin(),
    logout: (options) => auth.logout(options),
    destroy: () => {
      unsubscribe();
      subject.complete();
    },
  };
}
