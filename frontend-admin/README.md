# Frontend Admin

`frontend-admin` is the Next.js admin console for PinTool operators. It sits in front of the Nest backend and keeps admin tokens inside HTTP-only cookies while the browser talks only to the local BFF routes under `/api/admin/*`.

## Features

- Two-step admin login flow (`email/password` + TOTP)
- Server-side gate for protected admin routes
- `next-intl` locale switching with `en` and `zh-TW`
- Accessibility baseline: skip link, semantic landmarks, focus-visible styles
- Playwright smoke tests for login and route redirects

## Local Development

1. Install dependencies.

```bash
npm install
```

2. Copy the example environment file and fill in the admin JWT secret used by the backend.

```bash
cp .env.example .env.local
```

3. Start the frontend.

```bash
npm run dev
```

The admin app runs on `http://localhost:3100`.

## Required Environment Variables

- `ADMIN_BACKEND_URL`: Base URL for the Nest backend, usually `http://localhost:3000`
- `ADMIN_JWT_SECRET`: Must exactly match the backend's admin JWT signing secret

## Commands

```bash
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

## Testing Notes

- Playwright uses the local dev server on port `3100`
- Smoke coverage currently checks:
  - login page render
  - client-side login validation
  - protected-route redirect to `/login`
  - `/login/verify` redirect when the temp cookie is missing
