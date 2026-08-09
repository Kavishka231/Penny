# Penny

Penny is a full-stack personal finance intelligence platform for tracking income, expenses, budgets and manually entered transaction records.

## Features

- HttpOnly SameSite cookie authentication with per-session CSRF tokens and per-user data isolation.
- Transaction ledger for income and expenses with search, category labels and CSV export.
- Transaction editing and amount/date/type/category filters.
- Default and custom categories stored in PostgreSQL.
- Monthly category budgets with remaining balance and overspend status.
- Budget alerts when monthly spending exceeds a saved limit.
- Profile management for name, email, password, contact details and user settings.
- Password reset flow with local/dev reset token output.
- Analytics dashboard with cash flow metrics, category spend, budget progress, top merchants and six-month trends using Chart.js.
- Bank statement CSV import for bulk transaction upload.
- Manual transaction entry for accurate user-reviewed records.

## Stack

- Backend: Node.js, Express.js, PostgreSQL
- Frontend: HTML, CSS, vanilla JavaScript, Chart.js
- Charts: Chart.js
- Authentication: JWT stored only in an HttpOnly, SameSite session cookie
- Infrastructure: Docker and Docker Compose

## Production Start

1. Copy the production environment template and replace every placeholder:

   ```bash
   cp .env.production.example .env
   ```

2. Terminate TLS at a trusted reverse proxy or load balancer and forward
   `X-Forwarded-Proto`. Keep `TRUST_PROXY=true` and `FORCE_HTTPS=true`.

3. Start PostgreSQL and the production API:

   ```bash
   docker compose up -d --build postgres api
   ```

4. Enable persistent daily PostgreSQL backups:

   ```bash
   docker compose --profile backup up -d backup
   ```

The API applies unapplied, checksum-verified files from `backend/migrations/`
before accepting traffic. Run `npm run migrate` from `backend/` to apply them
manually. Backups are retained in the `postgres-backups` Docker volume for the
configured number of days. Periodically copy backups to separate encrypted
storage and test restoration with `pg_restore`.

The Compose configuration requires database, JWT, public URL, trusted-origin,
and SMTP values instead of shipping deployment credentials. The API serves the
frontend from the same production image.

Authenticated sessions use a 15-minute access cookie and a database-backed,
rotating refresh credential with a fixed 14-day lifetime. Logout and password
resets revoke server-side sessions immediately; refresh credentials are stored
only as SHA-256 hashes.

## CSV Import Format

The importer accepts CSV files with these common columns:

- `date` or `Date`
- `merchant`, `description` or `Description`
- `amount` or `Amount`
- optional `type`

Negative amounts are treated as expenses. Positive amounts default to income unless a `type` column is supplied.

## API Overview

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/categories`
- `POST /api/categories`
- `GET /api/transactions`
- `POST /api/transactions`
- `PATCH /api/transactions/:id` (`PUT` remains supported for compatibility)
- `DELETE /api/transactions/:id`
- `GET /api/budgets`
- `POST /api/budgets`
- `GET /api/analytics/summary`
- `GET /api/analytics/category-spend`
- `GET /api/analytics/trends`
- `GET /api/analytics/budget-progress`
- `GET /api/analytics/top-merchants`
- `POST /api/imports/csv`
- `GET /api/reports/transactions.csv`
- `GET /api/alerts`
- `GET /api/profile`
- `PATCH /api/profile` (`PUT` remains supported for compatibility)

## Project Structure

```text
backend/             Express API and route modules
backend/migrations/  Ordered production database migrations
database/schema.sql  In-memory test database bootstrap snapshot
frontend/            Static HTML, CSS and JavaScript app
docker-compose.yml   API and PostgreSQL services
scripts/              Operational backup tooling
```
