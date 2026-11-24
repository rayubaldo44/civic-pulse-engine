# Integration Tests Detailed Documentation

This document lists all integration test cases for the Civic Pulse Engine.

## 1. Row-Level Security (RLS) (`tests/integration/rls.test.ts`)

| Test Name                         | Description                                                              |
| :-------------------------------- | :----------------------------------------------------------------------- |
| `RLS — issue tables`              | authenticated users can SELECT seeded civic_issues                       |
| `RLS — issue tables`              | anon cannot read civic_issues (RLS default-deny)                         |
| `RLS — issue tables`              | analyst INSERT into civic_issues is blocked                              |
| `RLS — issue tables`              | analyst UPDATE of civic_issues silently matches zero rows                |
| `RLS — issue tables`              | analyst DELETE from civic_issues leaves the row intact                   |
| `RLS — issue tables`              | issue_comments and issue_status_logs writes are blocked for analysts     |
| `RLS — issue tables`              | service role can write issue rows (the app path)                         |
| `RLS — analytics/feedback tables` | authenticated SELECT on raw_content / processed_content / flagged_claims |
| `RLS — analytics/feedback tables` | analyst writes to raw/processed/flagged are blocked                      |
| `RLS — analytics/feedback tables` | anon cannot read raw or processed feedback (RLS default-deny)            |
| `RLS — documents`                 | authenticated SELECT on lgu_documents and document_chunks                |
| `RLS — documents`                 | authenticated INSERT on lgu_documents is allowed                         |
| `RLS — documents`                 | document_chunks writes are blocked for analysts                          |
| `RLS — documents`                 | profiles are readable by authenticated staff                             |

## 2. Role Authorization (`tests/integration/roles.test.ts`)

| Test Name            | Description                                                 |
| :------------------- | :---------------------------------------------------------- |
| `Role authorization` | audit_logs is SELECT-visible only to admins                 |
| `Role authorization` | audit_logs INSERT is open to all authenticated users        |
| `Role authorization` | nlp_categories INSERT is admin-only at the DB layer         |
| `Aggregate RPCs`     | get_sidebar_badges counts pending claims and my open tasks  |
| `Aggregate RPCs`     | get_analytics_totals returns every processed row            |
| `Aggregate RPCs`     | get_sentiment_counts reflects seeded labels                 |
| `Aggregate RPCs`     | get_topic_counts covers all six processed rows              |
| `Aggregate RPCs`     | get_review_tally maps human decisions to RAG determinations |
| `Aggregate RPCs`     | get_barangay_stats aggregates per barangay                  |
| `Aggregate RPCs`     | get_topic_window_stats folds engagement from raw_content    |

## 3. Database Constraints (`tests/integration/constraints.test.ts`)

| Test Name               | Description                                                   |
| :---------------------- | :------------------------------------------------------------ |
| `CHECK constraints`     | civic_issues rejects invalid priority                         |
| `CHECK constraints`     | civic_issues rejects invalid status                           |
| `CHECK constraints`     | raw_content rejects negative reaction_count                   |
| `CHECK constraints`     | processed_content rejects invalid sentiment_label             |
| `CHECK constraints`     | processed_content rejects non-Pulilan barangay_mention values |
| `CHECK constraints`     | flagged_claims rejects invalid status                         |
| `CHECK constraints`     | profiles rejects roles outside analyst/admin                  |
| `CHECK constraints`     | lgu_documents document_type CHECK accepts Executive Order     |
| `CHECK constraints`     | nlp_categories enforces the 60-char name limit                |
| `Referential integrity` | deleting a civic_issue cascades its comments and status logs  |

## 4. Migration Surface (`tests/integration/migrations.test.ts`)

| Test Name               | Description                                         |
| :---------------------- | :-------------------------------------------------- |
| `Migration surface`     | 004 — raw_content exposes engagement counters       |
| `Migration surface`     | 006 — document_chunks table is queryable            |
| `Migration surface`     | 008 — review_records table is queryable             |
| `Migration surface`     | 011 — audit_logs has the enriched resource columns  |
| `Migration surface`     | 012 — get_analytics_totals exists                   |
| `match_document_chunks` | returns nothing for an unrelated embedding          |
| `match_document_chunks` | returns the evidence chunk for a matching embedding |

## 5. Authentication (`tests/integration/auth.test.ts`)

| Test Name        | Description                                                     |
| :--------------- | :-------------------------------------------------------------- |
| `Authentication` | seeded admin signs in with the correct role claim               |
| `Authentication` | seeded analyst signs in with the analyst role claim             |
| `Authentication` | access token embeds app_metadata.role                           |
| `Authentication` | seeded profiles have password_set = true                        |
| `Authentication` | wrong password is rejected with a generic error                 |
| `Authentication` | admin can read its own profile through the authenticated client |
