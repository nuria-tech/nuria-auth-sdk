import {
  defineComponent,
  h,
  onMounted,
  onUnmounted,
  ref,
  type PropType,
} from 'vue';
import type { ActorClaim, AuthClient, TokenClaims } from '../core/types';

const HEIGHT = 44;
const CSS_VAR = '--nuria-imp-banner-height';

const WRAPPER_STYLE = {
  position: 'fixed' as const,
  top: '0',
  left: '0',
  right: '0',
  zIndex: '10000',
  display: 'flex',
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
  userSelect: 'none' as const,
};

const TEXT_STYLE = {
  flex: '1',
  minWidth: '0',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const,
};

const STOP_BTN_STYLE = {
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
  transition: 'background 0.15s',
  outline: 'none',
};

const ICON_STYLE = { flexShrink: '0', opacity: '0.85' };

function ShieldIcon() {
  return h(
    'svg',
    {
      width: 16,
      height: 16,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      style: ICON_STYLE,
      'aria-hidden': 'true',
    },
    [
      h('path', {
        d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
      }),
    ],
  );
}

function setBannerHeight(active: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty(
    CSS_VAR,
    active ? `${HEIGHT}px` : '0px',
  );
}

export const ImpersonationBanner = defineComponent({
  name: 'NuriaImpersonationBanner',

  props: {
    auth: {
      type: Object as PropType<AuthClient>,
      required: true,
    },
    stopLabel: {
      type: String,
      default: 'Encerrar sessão',
    },
    onStop: {
      type: Function as PropType<() => void | Promise<void>>,
      default: null,
    },
  },

  setup(props) {
    const isImpersonating = ref<boolean>(false);
    const actor = ref<ActorClaim | null>(null);
    const claims = ref<TokenClaims | null>(null);
    let unsub: (() => void) | null = null;

    function sync(): void {
      isImpersonating.value = props.auth.isImpersonating();
      actor.value = props.auth.getActor();
      claims.value = props.auth.getClaims();
      setBannerHeight(isImpersonating.value);
    }

    onMounted(() => {
      unsub = props.auth.onAuthStateChanged(sync);
      sync();
    });

    onUnmounted(() => {
      unsub?.();
      setBannerHeight(false);
    });

    async function stop(): Promise<void> {
      if (props.onStop) {
        await props.onStop();
      } else {
        await props.auth.stopImpersonation();
      }
    }

    return { isImpersonating, actor, claims, stop };
  },

  render() {
    if (!this.isImpersonating) return null;

    const actorName =
      (this.actor as ActorClaim | null)?.name ||
      (this.actor as ActorClaim | null)?.email ||
      'Operador';

    const targetName =
      (this.claims as TokenClaims | null)?.name ||
      (this.claims as TokenClaims | null)?.email ||
      'usuário';

    return h(
      'div',
      {
        role: 'alert',
        'aria-live': 'polite',
        'data-nuria-impersonation-banner': '',
        style: WRAPPER_STYLE,
      },
      [
        ShieldIcon(),
        h('span', { style: TEXT_STYLE }, [
          h('strong', null, 'Modo de suporte ativo'),
          ` — ${actorName} está visualizando a conta de `,
          h('strong', null, targetName),
          '. Esta sessão é auditada em conformidade com a LGPD (Lei 13.709/2018).',
        ]),
        h(
          'button',
          {
            type: 'button',
            style: STOP_BTN_STYLE,
            'aria-label': 'Encerrar sessão de suporte',
            onClick: this.stop,
          },
          this.stopLabel,
        ),
      ],
    );
  },
});
