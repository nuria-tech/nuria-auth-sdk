import { createServerAuth } from '../lib/auth';

export default async function HomePage() {
  const auth = createServerAuth();
  const token = await auth.getAccessToken();

  if (!token) {
    return (
      <form
        action={async () => {
          'use server';
          await auth.startLogin();
        }}
      >
        <button type="submit">Login</button>
      </form>
    );
  }

  return (
    <form
      action={async () => {
        'use server';
        await auth.logout();
      }}
    >
      <button type="submit">Logout</button>
    </form>
  );
}
