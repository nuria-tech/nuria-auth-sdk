import { Injectable } from '@angular/core';
import { createAuthClient } from '@nuria-tech/auth-sdk';
import { createAngularAuthFacade } from '@nuria-tech/auth-sdk/angular';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = createAuthClient({
    clientId: 'your-client-id',
    redirectUri: `${window.location.origin}/callback`,
  });

  private readonly facade = createAngularAuthFacade(this.auth);
  readonly state$ = this.facade.state$;

  login() {
    return this.facade.login();
  }

  logout() {
    return this.facade.logout();
  }

  refresh() {
    return this.facade.refresh();
  }

  async handleRedirectCallback(url: string) {
    return this.auth.handleRedirectCallback(url);
  }

  destroy() {
    this.facade.destroy();
  }
}
