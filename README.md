# Campux

Campux is being rebuilt as a TypeScript full-stack monolith with first-class multi-tenant support.

The previous Go/Vue microservice-era application has been moved to [`legacy/`](./legacy/). New architecture notes live in [`dev-docs/refactor-next/`](./dev-docs/refactor-next/).

Planned stack:

- Bun for package management and scripts
- Vite + React for the web app
- shadcn/ui for the component system
- TypeScript across frontend and backend
- PostgreSQL for data
- S3-compatible object storage
- In-memory workers with PostgreSQL-backed recovery state
