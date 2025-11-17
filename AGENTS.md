# Repository Guidelines

## Project Structure & Module Organization
The root splits implementation from docs: `backend/` hosts the Node.js + TypeScript API (routes under `src/routes`, queues under `src/queues`, Prisma schema in `prisma/`), while `frontend/` currently stores Shopify embedded-app scaffolding. Supporting material lives beside the code (`docs/DEPLOYMENT.md`, `HOW_TO_GUIDES.md`, `DECISIONS.md`) and Docker compose assets stay at the root for orchestration.

## Build, Test, and Development Commands
Run everything from `backend/` unless noted:
- `docker compose up db redis -d` boots PostgreSQL and Redis per `docker-compose.yml`.
- `npm install && cp .env.example .env` installs dependencies and prepares configuration.
- `npm run dev` starts the hot-reload API on `http://localhost:3002`.
- `npm run build && npm start` compiles TypeScript into `dist/` and serves the production bundle.
- `npm run db:migrate` applies Prisma migrations; pair with `npm run db:studio` when inspecting data.
- `npm run lint` and `npm run type-check` are the current guardrails in lieu of an automated Jest suite.

## Coding Style & Naming Conventions
Adopt 2-space indentation, TypeScript strictness, and ESLint defaults defined in `backend/package.json`. Files inside `src/` use camelCase (e.g., `errorHandler.ts`), exported classes/interfaces use PascalCase, and constants are SCREAMING_SNAKE_CASE. Keep request handlers slim by delegating to services, colocate middleware inside `src/middleware`, and never commit `.env` secrets.

## Testing Guidelines
Automated API tests are being introduced; until then, combine static checks (`npm run lint`, `npm run type-check`) with the exhaustive manual plan in `UAT_TEST_PLAN.md`. When adding a feature, extend that plan with numbered scenarios plus expected Shopify webhook payloads, then verify via the `/health` and `/admin/queues` endpoints.

## Commit & Pull Request Guidelines
Commits follow the short, imperative style visible in `git log` (e.g., "Fix TypeScript errors"). Each pull request must describe the problem, mention affected routes/queues, flag any required migration (`prisma/migrations/...`), and link issues or Notion tasks. Provide screenshots or cURL examples for API changes, list the local commands you ran, and ensure reviewers can reproduce by copying your `.env` variable deltas without exposing secrets.

## Security & Configuration Tips
Secrets live in `.env`; rotate `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SESSION_SECRET`, and database credentials whenever moving between environments. Use `deploy.sh` only after passing manual tests, and never push sample invite codes or webhook payloads that contain merchant data. Redis- and Postgres-related ports are exposed locally for convenience—tunnel or restrict them when staging deployments.
