# Penny

Penny is a full-stack personal finance intelligence platform for tracking income, expenses, budgets and manually entered transaction records.

## Features

- JWT authentication with per-user financial data isolation.
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
- Authentication: JWT
- Infrastructure: Docker and Docker Compose

## Quick Start

1. Copy the API environment template if you want local non-Docker development:

   ```bash
   cp backend/.env.example backend/.env
   ```

2. Start the full app with Docker:

   ```bash
   docker compose up --build
   ```

3. Open `http://localhost:3000`.

PostgreSQL is initialized from `database/schema.sql` and is available to the API on Docker's internal network. The API serves the frontend from the same origin, so no extra frontend build step is required.

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
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/categories`
- `POST /api/categories`
- `GET /api/transactions`
- `POST /api/transactions`
- `PUT /api/transactions/:id`
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
- `PUT /api/profile`

## Project Structure

```text
backend/             Express API and route modules
database/schema.sql  PostgreSQL schema and indexes
frontend/            Static HTML, CSS and JavaScript app
docker-compose.yml   API and PostgreSQL services
```
