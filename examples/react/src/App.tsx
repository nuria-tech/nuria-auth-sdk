import { AuthProvider, useAuth } from '@nuria-tech/auth-sdk/react';
import { auth } from './auth';

function AppContent() {
  const { session, isLoading, login, logout } = useAuth();

  if (isLoading) return <p>Loading...</p>;
  if (!session) return <button onClick={() => login()}>Login</button>;
  return <button onClick={() => logout()}>Logout</button>;
}

export function App() {
  return (
    <AuthProvider auth={auth}>
      <AppContent />
    </AuthProvider>
  );
}
