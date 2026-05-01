import { AuthError, AuthErrorCode } from '../errors/auth-error';

export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

let scriptPromise: Promise<void> | null = null;

/**
 * Loads the Google Identity Services script (`accounts.google.com/gsi/client`)
 * once per page. Both `google.accounts.id` (Sign in with Google / FedCM) and
 * `google.accounts.oauth2` (OAuth 2.0 token + code clients) live on the same
 * script tag, so this loader is shared across the SDK's google-* helpers.
 *
 * Resolves once `window.google.accounts` is populated, rejects with
 * `AuthError(NETWORK_ERROR)` if the script tag fails to load.
 */
export function loadGisScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(
      new AuthError(
        AuthErrorCode.INVALID_CONFIG,
        'Google Identity Services requires a browser environment',
      ),
    );
  }
  if (window.google?.accounts) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SCRIPT_URL}"]`,
    );
    const handleLoad = () => {
      if (window.google?.accounts) resolve();
      else
        reject(
          new AuthError(
            AuthErrorCode.NETWORK_ERROR,
            'GIS script loaded but window.google.accounts is missing',
          ),
        );
    };
    const handleError = () => {
      scriptPromise = null;
      reject(
        new AuthError(
          AuthErrorCode.NETWORK_ERROR,
          'Failed to load Google Identity Services script',
        ),
      );
    };
    if (existing) {
      existing.addEventListener('load', handleLoad, { once: true });
      existing.addEventListener('error', handleError, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    document.head.appendChild(script);
  });

  return scriptPromise;
}
