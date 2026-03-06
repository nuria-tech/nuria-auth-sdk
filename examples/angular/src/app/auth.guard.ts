import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const canActivate = await firstValueFrom(
    auth.state$.pipe(
      map((state) => state.isAuthenticated),
      tap((isAuthenticated) => {
        if (!isAuthenticated) {
          void auth.login();
        }
      }),
    ),
  );

  if (!canActivate) {
    return router.parseUrl('/');
  }

  return true;
};
