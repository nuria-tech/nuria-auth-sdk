import { Component, inject } from '@angular/core';
import { AsyncPipe, JsonPipe, NgIf } from '@angular/common';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-auth-status',
  standalone: true,
  imports: [NgIf, AsyncPipe, JsonPipe],
  template: `
    <ng-container *ngIf="auth.state$ | async as state">
      <p>Loading: {{ state.isLoading }}</p>
      <p>Authenticated: {{ state.isAuthenticated }}</p>
      <pre *ngIf="state.session">{{ state.session | json }}</pre>

      <button *ngIf="!state.isAuthenticated" (click)="login()">Login</button>
      <button *ngIf="state.isAuthenticated" (click)="logout()">Logout</button>
    </ng-container>
  `,
})
export class AuthStatusComponent {
  readonly auth = inject(AuthService);

  login() {
    void this.auth.login();
  }

  logout() {
    void this.auth.logout();
  }
}
