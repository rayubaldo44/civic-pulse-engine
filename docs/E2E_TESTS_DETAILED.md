# End-to-End (E2E) Tests Detailed Documentation

This document lists all E2E test cases for the Civic Pulse Engine.

## 1. Issue Tracker (`tests/e2e/issues.spec.ts`)

| Test Name       | Description                                       |
| :-------------- | :------------------------------------------------ |
| `Issue Tracker` | board renders 5 columns with issue cards          |
| `Issue Tracker` | toggle to table view                              |
| `Issue Tracker` | click card opens slide-over and transition status |
| `Issue Tracker` | post a comment in the slide-over                  |
| `Issue Tracker` | Escape key closes slide-over                      |

## 2. Flagged Claims (`tests/e2e/flagged-claims.spec.ts`)

| Test Name         | Description                                           |
| :---------------- | :---------------------------------------------------- |
| `Review UI`       | pending claim is visible with review buttons enabled  |
| `Review UI`       | review a claim as Verified True                       |
| `Review UI`       | previously reviewed claims show disabled buttons      |
| `Claim Detection` | claim detected → appears in Flagged Claims as Pending |
| `Claim Detection` | RAG Supported: claim matching LGU document            |
| `Claim Detection` | RAG Refuted: claim contradicted by LGU document       |
| `Claim Detection` | RAG Insufficient Evidence: no matching LGU document   |
| `Claim Detection` | matched_patterns are extracted and stored             |

## 3. Admin Page (`tests/e2e/admin.spec.ts`)

| Test Name      | Description                                                  |
| :------------- | :----------------------------------------------------------- |
| `admin user`   | admin sees NLP Engine Configuration and Authorized Personnel |
| `analyst user` | analyst is redirected to the dashboard                       |

## 4. Authentication (`tests/e2e/auth.spec.ts`)

| Test Name         | Description                                        |
| :---------------- | :------------------------------------------------- |
| `unauthenticated` | redirects to /login when visiting a protected page |
| `admin`           | dashboard loads after login                        |
| `admin`           | admin can access /Authenticated/admin              |
| `analyst`         | dashboard loads after login                        |
| `analyst`         | admin config bounces to dashboard                  |
| `bad credentials` | shows generic error for wrong password             |
| `logged-in user`  | bounces to dashboard                               |
| `logout`          | signs out and redirects to login                   |

## 5. Reports (`tests/e2e/reports.spec.ts`)

| Test Name         | Description                                           |
| :---------------- | :---------------------------------------------------- |
| `Reports page`    | page heading loads                                    |
| `analyst exports` | issues CSV download is available                      |
| `analyst exports` | flagged claims CSV download is available              |
| `analyst exports` | weekly summary PDF is non-empty                       |
| `analyst exports` | audit XLSX is NOT available for analyst (admin-gated) |
| `admin exports`   | audit XLSX is visible and downloadable                |

## 6. Preprocessing (`tests/e2e/preprocessing.spec.ts`)

| Test Name                | Description                                        |
| :----------------------- | :------------------------------------------------- |
| `Preprocessing Pipeline` | spam comment is marked processed without NLP calls |
| `Preprocessing Pipeline` | language detection: Tagalog comment gets tl        |
| `Preprocessing Pipeline` | language detection: English comment gets en        |
| `Preprocessing Pipeline` | hashed_user_id is stable for same author           |

## 7. Sentiment Trends (`tests/e2e/sentiment-trends.spec.ts`)

| Test Name | Description                                |
| :-------- | :----------------------------------------- |
| `Trends`  | Live range shows 12 hourly buckets         |
| `Trends`  | Weekly range shows 28 daily buckets        |
| `Trends`  | Monthly range shows days-so-far buckets    |
| `Trends`  | Yearly range shows 12 monthly buckets      |
| `Trends`  | Topic filter changes series data           |
| `Trends`  | Platform filter changes series data        |
| `Trends`  | review sentiment folds into Neutral bucket |

## 8. Dashboard (`tests/e2e/dashboard.spec.ts`)

| Test Name   | Description                                                |
| :---------- | :--------------------------------------------------------- |
| `Dashboard` | stat cards render with non-empty values                    |
| `Dashboard` | chart sections render (sentiment trend canvas)             |
| `Dashboard` | tabs switch between Heatmap, Issue Prioritization, Tracker |
| `Dashboard` | sidebar badge for pending claims is visible                |
