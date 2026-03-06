import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-auth-callback',
  standalone: true,
  template: `<p>Finalizing login...</p>`,
})
export class AuthCallbackComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  async ngOnInit() {
    try {
      await this.auth.handleRedirectCallback(window.location.href);
      await this.router.navigateByUrl('/protected');
    } catch {
      await this.router.navigateByUrl('/');
    }
  }
}
