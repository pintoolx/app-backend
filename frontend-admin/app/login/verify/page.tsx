import { VerifyForm } from './verify-form';

export default function VerifyPage() {
  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center bg-background px-4"
      aria-labelledby="verify-title"
    >
      <VerifyForm />
    </main>
  );
}
