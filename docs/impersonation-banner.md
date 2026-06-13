# Impersonation Banner

The `ImpersonationBanner` renders a **fixed, non-dismissable** notice bar at the top of the viewport whenever an operator session is active (RFC 8693 `act` claim present). It satisfies the LGPD Art. 37 audit-trail requirement for support access to user accounts.

The banner:

- Sits at `position: fixed; top: 0; z-index: 10000` — always visible above all app content.
- Cannot be hidden or closed while impersonation is active; only the stop button ends the session.
- Sets `--nuria-imp-banner-height` (`44px` when active, `0px` otherwise) on `<html>` so layouts can offset their content.
- Is fully reactive via `onAuthStateChanged` — appears and disappears automatically as impersonation state changes.

---

## Automatic setup (recommended)

Call `mountImpersonationBanner(auth)` once in your auth plugin. No template changes needed — the banner is appended directly to `document.body` as a standalone Vue app.

### Nuxt plugin (`plugins/auth.client.ts`)

```ts
import { createAuthClient } from '@nuria-tech/auth-sdk';
import { mountImpersonationBanner } from '@nuria-tech/auth-sdk/vue';

export default defineNuxtPlugin(async () => {
  const auth = createAuthClient({ /* ... */ });
  await auth.ready;

  // One line — banner mounts automatically for every portal that uses this plugin.
  mountImpersonationBanner(auth);

  return { provide: { auth } };
});
```

### With a custom stop handler

If your portal needs to navigate after stopping impersonation, pass `onStop`:

```ts
const router = useRouter();

mountImpersonationBanner(auth, {
  stopLabel: 'Sair',                    // optional — defaults to "Encerrar sessão"
  onStop: async () => {
    await auth.stopImpersonation();     // must call this yourself when onStop is provided
    await router.push('/users');
  },
});
```

> **Note:** When `onStop` is provided the SDK does **not** call `stopImpersonation()` automatically — your handler owns the full teardown.

### Plain Vue plugin

```ts
import { createApp } from 'vue';
import { createAuthClient } from '@nuria-tech/auth-sdk';
import { mountImpersonationBanner } from '@nuria-tech/auth-sdk/vue';

const auth = createAuthClient({ /* ... */ });
await auth.ready;

mountImpersonationBanner(auth);

const app = createApp(App);
app.mount('#app');
```

---

## Layout offset

The function writes `--nuria-imp-banner-height` on `<html>`. Apply it to your app shell to prevent content from being hidden behind the banner:

```css
.app-shell {
  margin-top: var(--nuria-imp-banner-height, 0px);
  height: calc(100dvh - var(--nuria-imp-banner-height, 0px));
}
```

---

## Declarative alternative

If you prefer to control the banner placement yourself (e.g. inside a specific layout), use the `ImpersonationBanner` Vue component directly:

```vue
<script setup lang="ts">
import { ImpersonationBanner } from '@nuria-tech/auth-sdk/vue';
const { $auth } = useNuxtApp();
</script>

<template>
  <!-- Render before any other layout element -->
  <ImpersonationBanner :auth="$auth" stop-label="Sair" :on-stop="handleStop" />
  <div class="app-shell">
    <!-- ... -->
  </div>
</template>
```

The component exposes the same props as `mountImpersonationBanner` options:

| Prop | Type | Default | Description |
|---|---|---|---|
| `auth` | `AuthClient` | required | The auth client instance |
| `stopLabel` | `string` | `"Encerrar sessão"` | Label for the stop button |
| `onStop` | `() => void \| Promise<void>` | — | Custom stop handler (if omitted, calls `stopImpersonation()`) |

---

## Idempotency

`mountImpersonationBanner` is safe to call multiple times — subsequent calls on the same page are no-ops (it checks for an existing `#nuria-imp-banner-root` element). The returned function unmounts the banner and removes the DOM node when called, which is useful for HMR teardown.

---

## Security rationale

Support operators must always know they are viewing another user's account. A dismissable banner creates the risk of the operator forgetting the context and taking actions they believe are on their own account. Making the banner non-dismissable and fixed above all other UI enforces that invariant at the SDK level, so individual portals cannot accidentally (or intentionally) skip it.

The `data-nuria-impersonation-banner` attribute on the root element can be used by automated tests and browser extensions to detect active impersonation sessions.
