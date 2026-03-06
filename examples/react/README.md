# React Example

Minimal React integration using `@nuria-tech/auth-sdk/react`.

## Files

- `src/auth.ts`: SDK client instance
- `src/App.tsx`: provider + auth UI
- `src/CallbackPage.tsx`: callback handler route

## Install

```bash
npm install @nuria-tech/auth-sdk react react-dom
```

## Notes

- Wrap app with `AuthProvider`.
- Use `useAuth()` for auth state and actions.
- Configure your OAuth callback URL to `/callback`.
