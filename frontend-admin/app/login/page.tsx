import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center bg-background px-4"
      aria-labelledby="login-title"
    >
      <LoginForm />
    </main>
  );
}
