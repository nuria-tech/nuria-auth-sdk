import { createNextAuthClient } from '@nuria-tech/auth-sdk/next';
import { cookies } from 'next/headers';

export function createServerAuth() {
  const store = cookies();
  return createNextAuthClient(
    {
      clientId: process.env.NEXT_PUBLIC_AUTH_CLIENT_ID ?? 'your-client-id',
      redirectUri:
        process.env.NEXT_PUBLIC_AUTH_CALLBACK_URL ??
        'http://localhost:3000/callback',
    },
    {
      get: (name) => store.get(name)?.value,
      set: (name, value) => store.set(name, value),
      remove: (name) => store.delete(name),
    },
  );
}
