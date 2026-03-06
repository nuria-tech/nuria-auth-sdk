import { redirect } from 'next/navigation';
import { createServerAuth } from '../../lib/auth';

export default async function CallbackPage() {
  const auth = createServerAuth();

  try {
    await auth.handleRedirectCallback();
  } finally {
    redirect('/');
  }
}
