import { createAuthClient } from '@nuria-tech/auth-sdk';

export const auth = createAuthClient({
  clientId: 'your-client-id',
  redirectUri: `${window.location.origin}/callback`,
});
