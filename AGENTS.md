# Repository Guidelines

## Project Structure & Module Organization
- `app/`: Next.js App Router pages and API routes (e.g., `app/api/twiml`, `app/api/stream/twilio`). Route files live at `app/api/<name>/route.ts`.
- `components/`: React UI. Primitives in `components/ui/`.
- `lib/`: Server/shared utilities (`openai.ts`, `twilio.ts`, `webhooks.ts`, `validation.ts`, `config.ts`). Prefer pure, testable functions.
- `tests/`: Jest tests (e.g., `tests/validation.test.ts`).
- `realtime-docs/`: PDFs and notes (non-code).

## Build, Test, and Development Commands
- `npm run dev`: Start Next.js dev server at `http://localhost:3000`.
- `npm run build`: Production build outputs to `.next/`.
- `npm start`: Serve the built app.
- `npm run lint`: Lint with the Next.js ESLint config.
- `npm test`: Run Jest (jsdom + TS via ts-jest).

## Coding Style & Naming Conventions
- Language: TypeScript (strict). Path alias `@/` maps to repo root.
- Indentation: 2 spaces; no unused vars; keep functions small and pure in `lib/`.
- Filenames: React components as `PascalCase.tsx` in `components/`; utilities as `camelCase.ts` in `lib/`.
- APIs: App Router under `app/api/.../route.ts` (lowercase dirs).
- Linting: Keep `npm run lint` clean before PRs.

## Testing Guidelines
- Frameworks: Jest + Testing Library (`@testing-library/react`, `@testing-library/jest-dom`).
- Location/Names: `tests/**/*.(test|spec).ts(x)`; mirror source names.
- Focus: Validate Zod schemas, API handlers, and UI behavior. Example: see `tests/validation.test.ts` for E.164 parsing.
- Run: `npm test` locally; ensure all pass before pushing.

## Commit & Pull Request Guidelines
- Commits: Conventional Commits (e.g., `feat(twiml): ...`, `fix(stream): ...`, `chore: ...`, `docs: ...`).
- PRs must include: clear description, context, linked issues; tests for behavior changes; screenshots for UI.
- Checklist: `npm run lint` and `npm test` pass; no `.env` or secrets included.

## Security & Configuration Tips
- Copy `.env.example` to `.env` for server-only secrets. Avoid `NEXT_PUBLIC_*` for sensitive values.
- Use canonical `PUBLIC_BASE_URL` that matches Twilio callbacks to avoid WS handshake issues.
- Keep dev-only flags like `ALLOW_CLIENT_CREDS` disabled in production.
