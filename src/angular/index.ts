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

export interface MountImpersonationBannerOptions {
  /** Label for the stop button. Defaults to `"Encerrar sessão"`. */
  stopLabel?: string;
  /**
   * Custom handler called when the operator clicks the stop button.
   * If omitted the SDK calls `auth.stopImpersonation()` directly.
   */
  onStop?: () => void | Promise<void>;
}

const BANNER_ID = 'nuria-imp-banner-root';
const HEIGHT = 44;
const CSS_VAR = '--nuria-imp-banner-height';

function setBannerHeight(active: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty(
    CSS_VAR,
    active ? `${HEIGHT}px` : '0px',
  );
}

/**
 * Mounts the impersonation banner as a plain DOM element appended to
 * `document.body`. No framework dependency — works in any Angular app.
 *
 * The banner renders only while `auth.isImpersonating()` is true.
 * Sets `--nuria-imp-banner-height` on `<html>` (`44px` active, `0px` inactive)
 * so the layout can shift down:
 * ```css
 * .app-shell { margin-top: var(--nuria-imp-banner-height, 0px); }
 * ```
 *
 * Returns an `unmount` function — call it only during HMR teardown.
 * Subsequent calls are no-ops (idempotent).
 */
export function mountImpersonationBanner(
  auth: AuthClient,
  options?: MountImpersonationBannerOptions,
): () => void {
  if (typeof document === 'undefined') return () => {};
  if (document.getElementById(BANNER_ID)) return () => {};

  const stopLabel = options?.stopLabel ?? 'Encerrar sessão';

  // ── Build DOM ──────────────────────────────────────────────────────────────

  const root = document.createElement('div');
  root.id = BANNER_ID;

  const wrapper = document.createElement('div');
  Object.assign(wrapper.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    zIndex: '10000',
    display: 'none', // hidden until impersonation starts
    alignItems: 'center',
    gap: '8px',
    padding: '0 20px',
    height: `${HEIGHT}px`,
    background: 'linear-gradient(90deg, #4f1d96 0%, #6d28d9 100%)',
    color: '#ffffff',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: '13.5px',
    fontWeight: '400',
    lineHeight: '1.3',
    boxShadow: '0 2px 12px rgba(79,29,150,0.45)',
    userSelect: 'none',
    boxSizing: 'border-box',
  });
  wrapper.setAttribute('role', 'alert');
  wrapper.setAttribute('aria-live', 'polite');
  wrapper.setAttribute('data-nuria-impersonation-banner', '');

  // Shield icon
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('width', '16');
  icon.setAttribute('height', '16');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  icon.style.flexShrink = '0';
  icon.style.opacity = '0.85';
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z');
  icon.appendChild(path);

  // Text span
  const text = document.createElement('span');
  Object.assign(text.style, {
    flex: '1',
    minWidth: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  });

  // Stop button
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = stopLabel;
  btn.setAttribute('aria-label', 'Encerrar sessão de suporte');
  Object.assign(btn.style, {
    flexShrink: '0',
    marginLeft: '12px',
    padding: '5px 14px',
    border: '1.5px solid rgba(255,255,255,0.55)',
    borderRadius: '6px',
    background: 'rgba(255,255,255,0.10)',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
    outline: 'none',
    transition: 'background 0.15s',
  });
  btn.addEventListener('mouseenter', () => {
    btn.style.background = 'rgba(255,255,255,0.22)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'rgba(255,255,255,0.10)';
  });
  btn.addEventListener('click', async () => {
    if (options?.onStop) {
      await options.onStop();
    } else {
      await auth.stopImpersonation();
    }
  });

  wrapper.appendChild(icon);
  wrapper.appendChild(text);
  wrapper.appendChild(btn);
  root.appendChild(wrapper);
  document.body.appendChild(root);

  // ── Sync state ─────────────────────────────────────────────────────────────

  function render(): void {
    const impersonating = auth.isImpersonating();
    const actor = auth.getActor();
    const claims = auth.getClaims() as Record<string, unknown> | null;

    if (impersonating && actor) {
      const actorName = (actor.name ?? actor.email ?? 'Operador') as string;
      const targetName = (claims?.['name'] ??
        claims?.['email'] ??
        'usuário') as string;

      text.innerHTML = '';
      const strong1 = document.createElement('strong');
      strong1.textContent = 'Modo de suporte ativo';
      const strong2 = document.createElement('strong');
      strong2.textContent = targetName;
      text.appendChild(strong1);
      text.appendChild(
        document.createTextNode(
          ` — ${actorName} está visualizando a conta de `,
        ),
      );
      text.appendChild(strong2);
      text.appendChild(
        document.createTextNode(
          '. Esta sessão é auditada em conformidade com a LGPD (Lei 13.709/2018).',
        ),
      );

      wrapper.style.display = 'flex';
    } else {
      wrapper.style.display = 'none';
    }

    setBannerHeight(impersonating && actor !== null);
  }

  const unsubscribe = auth.onAuthStateChanged(render);
  render();

  return () => {
    unsubscribe();
    setBannerHeight(false);
    root.remove();
  };
}
