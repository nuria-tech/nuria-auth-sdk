# Angular Example

Minimal Angular integration using `@nuria-tech/auth-sdk/angular`.

## Files

- `src/app/auth.service.ts`: wraps SDK client + Angular facade
- `src/app/auth.guard.ts`: protects routes and redirects to login
- `src/app/auth-status.component.ts`: shows auth state and login/logout buttons
- `src/app/auth-callback.component.ts`: handles OAuth callback route
- `src/app/app.routes.ts`: sample route config

## Install

```bash
npm install @nuria-tech/auth-sdk rxjs
```

## Wire into your app

1. Copy files into your Angular app.
2. Update `clientId` and `redirectUri` in `auth.service.ts`.
3. Register routes from `app.routes.ts`.
4. Configure your OAuth provider callback URL to `/callback`.

## Notes

- `AuthGuard` triggers `login()` when unauthenticated.
- `AuthCallbackComponent` runs `handleRedirectCallback(...)` and navigates back.
- `state$` can be consumed with `async` pipe in templates.
