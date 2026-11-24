# Testing Summary — Civic Pulse Engine

This document provides a summary of the automated test suite for the Civic Pulse Engine, covering both unit tests and end-to-end (E2E) workflows. This data is intended for use in the capstone paper to demonstrate the verification and reliability of the system.

## 1. Overview

| Test Type      | Framework  | Total Tests | Status      | Run Command            |
| :------------- | :--------- | :---------- | :---------- | :--------------------- |
| **Unit Tests** | Vitest     | 391         | All Passing | `pnpm vitest run`      |
| **E2E Tests**  | Playwright | 44          | All Passing | `pnpm playwright test` |

---

## 2. Unit Testing

For a detailed breakdown of unit tests, please refer to [docs/UNIT_TESTS.md](./UNIT_TESTS.md).

- **Scope:** Targets three layers: pure business logic, server/API route handlers, and Svelte UI components.
- **Approach:** Deterministic unit testing with `fake-supabase` to assert query structures without requiring a live database connection.

---

## 3. End-to-End (E2E) Testing

E2E tests validate full user workflows and integration between the frontend, Supabase, and Edge functions.

| Test File                  | Workflow Covered                                                                |
| :------------------------- | :------------------------------------------------------------------------------ |
| `auth.spec.ts`             | User login, session management, and redirection security.                       |
| `dashboard.spec.ts`        | Data rendering, filtering, and metric accuracy on the main dashboard.           |
| `issues.spec.ts`           | Full lifecycle of issue management (creation, transition, comments).            |
| `admin.spec.ts`            | Administrative access, staff management, and audit logging.                     |
| `flagged-claims.spec.ts`   | Content moderation, review workflows, and claim status updates.                 |
| `reports.spec.ts`          | Audit report generation and weekly summary data accuracy.                       |
| `sentiment-trends.spec.ts` | Accuracy of sentiment analysis trends over specified time windows.              |
| `preprocessing.spec.ts`    | Data normalization and RAG (Retrieval-Augmented Generation) pipeline ingestion. |

---

## 4. Verification

The suite is part of the project verification bar for every code change:

```bash
pnpm vitest run && pnpm playwright test && pnpm check && pnpm format && pnpm lint
```
