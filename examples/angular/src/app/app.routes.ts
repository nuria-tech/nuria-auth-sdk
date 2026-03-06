import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthCallbackComponent } from './auth-callback.component';
import { AuthStatusComponent } from './auth-status.component';

export const routes: Routes = [
  { path: '', component: AuthStatusComponent },
  { path: 'callback', component: AuthCallbackComponent },
  {
    path: 'protected',
    canActivate: [authGuard],
    component: AuthStatusComponent,
  },
];
