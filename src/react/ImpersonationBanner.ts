import {
  createElement,
  useEffect,
  useState,
  type CSSProperties,
  type FC,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ActorClaim, AuthClient, TokenClaims } from '../core/types';

const HEIGHT = 44;
const CSS_VAR = '--nuria-imp-banner-height';
const BANNER_ROOT_ID = 'nuria-imp-banner-root';

const WRAPPER_STYLE: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  zIndex: 10000,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 20px',
  height: HEIGHT,
  background: 'linear-gradient(90deg, #4f1d96 0%, #6d28d9 100%)',
  color: '#ffffff',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSize: 13.5,
  fontWeight: 400,
  lineHeight: 1.3,
  boxShadow: '0 2px 12px rgba(79,29,150,0.45)',
  userSelect: 'none',
  boxSizing: 'border-box',
};

const TEXT_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const STOP_BTN_STYLE: CSSProperties = {
  flexShrink: 0,
  marginLeft: 12,
  padding: '5px 14px',
  border: '1.5px solid rgba(255,255,255,0.55)',
  borderRadius: 6,
  background: 'rgba(255,255,255,0.10)',
  color: '#ffffff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  outline: 'none',
};

const ICON_STYLE: CSSProperties = { flexShrink: 0, opacity: 0.85 };

function setBannerHeight(active: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty(
    CSS_VAR,
    active ? `${HEIGHT}px` : '0px',
  );
}

function ShieldIcon() {
  return createElement(
    'svg',
    {
      width: 16,
      height: 16,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      style: ICON_STYLE,
      'aria-hidden': 'true',
    },
    createElement('path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }),
  );
}

/** Options accepted by {@link ImpersonationBanner} and {@link mountImpersonationBanner}. */
export interface MountImpersonationBannerOptions {
  /** Label for the stop button. Defaults to `"Encerrar sessão"`. */
  stopLabel?: string;
  /**
   * Custom handler called when the operator clicks the stop button.
   * If omitted the SDK calls `auth.stopImpersonation()` directly.
   */
  onStop?: () => void | Promise<void>;
}

interface BannerProps extends MountImpersonationBannerOptions {
  auth: AuthClient;
}

export const ImpersonationBanner: FC<BannerProps> = ({
  auth,
  stopLabel = 'Encerrar sessão',
  onStop,
}) => {
  const [isImpersonating, setIsImpersonating] = useState(() =>
    auth.isImpersonating(),
  );
  const [actor, setActor] = useState<ActorClaim | null>(() => auth.getActor());
  const [claims, setClaims] = useState<TokenClaims | null>(() =>
    auth.getClaims(),
  );

  useEffect(() => {
    const sync = () => {
      const imp = auth.isImpersonating();
      setIsImpersonating(imp);
      setActor(auth.getActor());
      setClaims(auth.getClaims());
      setBannerHeight(imp);
    };
    const unsub = auth.onAuthStateChanged(sync);
    sync();
    return () => {
      unsub();
      setBannerHeight(false);
    };
  }, [auth]);

  if (!isImpersonating) return null;

  const actorName = actor?.name ?? actor?.email ?? 'Operador';
  const targetName =
    (claims as TokenClaims | null)?.name ??
    (claims as TokenClaims | null)?.email ??
    'usuário';

  const handleStop = () => {
    if (onStop) {
      void onStop();
    } else {
      void auth.stopImpersonation();
    }
  };

  return createElement(
    'div',
    {
      role: 'alert',
      'aria-live': 'polite',
      'data-nuria-impersonation-banner': '',
      style: WRAPPER_STYLE,
    },
    ShieldIcon(),
    createElement(
      'span',
      { style: TEXT_STYLE },
      createElement('strong', null, 'Modo de suporte ativo'),
      ` — ${actorName} está visualizando a conta de `,
      createElement('strong', null, targetName),
      '. Esta sessão é auditada em conformidade com a LGPD (Lei 13.709/2018).',
    ),
    createElement(
      'button',
      {
        type: 'button',
        style: STOP_BTN_STYLE,
        'aria-label': 'Encerrar sessão de suporte',
        onClick: handleStop,
      },
      stopLabel,
    ),
  );
};

/**
 * Mounts the {@link ImpersonationBanner} as a standalone React root appended
 * to `document.body`. Call once during app initialization — subsequent calls
 * are no-ops (idempotent). Returns an `unmount` teardown function.
 *
 * Requires `react-dom` >= 18.
 */
export function mountImpersonationBanner(
  auth: AuthClient,
  options?: MountImpersonationBannerOptions,
): () => void {
  if (typeof document === 'undefined') return () => {};
  if (document.getElementById(BANNER_ROOT_ID)) return () => {};

  const container = document.createElement('div');
  container.id = BANNER_ROOT_ID;
  document.body.appendChild(container);

  const root: Root = createRoot(container);
  root.render(createElement(ImpersonationBanner, { auth, ...options }));

  return () => {
    root.unmount();
    container.remove();
  };
}
