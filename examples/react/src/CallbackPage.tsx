import { useEffect } from 'react';
import { auth } from './auth';

export function CallbackPage() {
  useEffect(() => {
    void auth
      .handleRedirectCallback(window.location.href)
      .then(() => {
        window.location.assign('/');
      })
      .catch(() => {
        window.location.assign('/');
      });
  }, []);

  return <p>Finalizing login...</p>;
}
