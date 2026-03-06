import { createNuxtAuthClient } from '@nuria-tech/auth-sdk/nuxt';

export function useAuthClient() {
  return createNuxtAuthClient(
    {
      clientId: 'your-client-id',
      redirectUri: `${window.location.origin}/callback`,
    },
    {
      get: (name) => useCookie<string | null>(name).value,
      set: (name, value) => {
        useCookie<string | null>(name).value = value;
      },
      remove: (name) => {
        useCookie<string | null>(name).value = null;
      },
    },
  );
}
