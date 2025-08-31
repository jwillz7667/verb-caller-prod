# Repository Guidelines

## Project Structure & Module Organization
- `app/`: Next.js App Router pages and API routes (e.g., `app/api/twiml`, `app/api/stream/twilio`).
- `components/`: React UI, with `components/ui/` for primitives.
- `lib/`: Server and shared utilities (`openai.ts`, `twilio.ts`, `webhooks.ts`, `validation.ts`, `config.ts`).
- `tests/`: Jest tests (example: `tests/validation.test.ts`).
- `realtime-docs/`: Reference PDFs and notes (non-code).

## Build, Test, and Development Commands
- `npm run dev`: Start Next.js dev server on `http://localhost:3000`.
- `npm run build`: Production build (`.next/`).
- `npm start`: Run the built app.
- `npm run lint`: Lint with Next.js ESLint config.
- `npm test`: Run Jest tests (jsdom + TS via ts-jest).

## Coding Style & Naming Conventions
- **Language**: TypeScript (strict). Path alias `@/` maps to repo root.
- **Indentation**: 2 spaces; no unused vars; prefer pure functions in `lib/`.
- **Files**: React components `PascalCase.tsx` in `components/`; utilities `camelCase.ts` in `lib/`.
- **APIs**: App Router route files live under `app/api/.../route.ts` (lowercase dirs).
- **Linting**: Keep `npm run lint` clean before PRs.

## Testing Guidelines
- **Frameworks**: Jest + Testing Library (`@testing-library/react`, `@testing-library/jest-dom`).
- **Location/Names**: `tests/**/*.(test|spec).ts(x)`; mirror source names when possible.
- **Focus**: Validate Zod schemas, API handlers, and UI behavior. Example: `tests/validation.test.ts` covers E.164 parsing.
- **Run**: `npm test` locally and ensure passing.

## Commit & Pull Request Guidelines
- **Commits**: Prefer Conventional Commits (e.g., `feat(twiml): ...`, `fix(stream): ...`, `chore: ...`, `docs: ...`).
- **PRs must include**:
  - Clear description, context, and linked issues.
  - Test updates for behavior changes; screenshots for UI.
  - Checklist: `npm run lint` and `npm test` pass; no `.env` or secrets.

## Security & Configuration Tips
- Copy `.env.example` → `.env` (server-only secrets). Avoid `NEXT_PUBLIC_*` for sensitive values.
- Use canonical `PUBLIC_BASE_URL` (matches Twilio callbacks) to avoid WS handshake issues.
- Dev-only flags like `ALLOW_CLIENT_CREDS` should remain disabled in production.
