# Unit Tests Detailed Documentation

This document lists all unit test cases for the Civic Pulse Engine.

## 1. Password Validation (`tests/unit/password.test.ts`)

| Test Name             | Description                                                                       |
| :-------------------- | :-------------------------------------------------------------------------------- |
| `PASSWORD_MIN_LENGTH` | Validates minimum length is 12                                                    |
| `validateNewPassword` | `passing cases`: accepts a strong password with matching confirm                  |
| `validateNewPassword` | `passing cases`: accepts unicode and space as special characters                  |
| `validateNewPassword` | `rule: empty password`: rejects empty password with exact error                   |
| `validateNewPassword` | `rule: minimum length`: rejects an 11-character password even if otherwise strong |
| `validateNewPassword` | `rule: minimum length`: accepts exactly 12 characters                             |
| `validateNewPassword` | `rule: lowercase letter`: rejects password with no lowercase letter               |
| `validateNewPassword` | `rule: uppercase letter`: rejects password with no uppercase letter               |
| `validateNewPassword` | `rule: digit`: rejects password with no digit                                     |
| `validateNewPassword` | `rule: special character`: rejects purely alphanumeric password                   |
| `validateNewPassword` | `rule: confirmation match`: rejects mismatched confirmation                       |
| `validateNewPassword` | `check order`: empty beats mismatch                                               |
| `validateNewPassword` | `check order`: length beats complexity and mismatch                               |
| `validateNewPassword` | `check order`: length beats missing lowercase                                     |
| `validateNewPassword` | `check order`: lowercase beats uppercase and mismatch                             |
| `validateNewPassword` | `check order`: uppercase beats digit                                              |
| `validateNewPassword` | `check order`: digit beats special character                                      |
| `validateNewPassword` | `check order`: special character beats confirmation match                         |
| `maskEmail`           | keeps first 2 local chars, masks the rest, keeps full domain                      |
| `maskEmail`           | masks a 3-character local part down to first char + bullet                        |
| `maskEmail`           | handles 2-character local part by keeping only the first character                |
| `maskEmail`           | single-character local part has nothing to mask                                   |
| `maskEmail`           | returns placeholder for empty string                                              |
| `maskEmail`           | returns placeholder when there is no @                                            |
| `maskEmail`           | returns placeholder for empty local part                                          |
| `maskEmail`           | returns placeholder for empty domain                                              |

## 2. Dashboard Trends (`tests/unit/dashboard-trend.test.ts`)

| Test Name        | Description                                              |
| :--------------- | :------------------------------------------------------- |
| `buildTrendData` | hourly mode: buckets recent records by hour              |
| `buildTrendData` | hourly mode: ignores records older than 12 hours         |
| `buildTrendData` | hourly mode: places record at bucket start correctly     |
| `buildTrendData` | daily fallback: uses 7 daily buckets when no hourly data |
| `buildTrendData` | daily fallback: labels buckets with short dates          |
| `buildTrendData` | empty: returns empty arrays for no records               |
| `buildTrendData` | empty: returns empty for records older than 7 days       |
| `buildTrendData` | works without explicit now argument                      |

## 3. Topic Priorities (`tests/unit/priority.test.ts`)

| Test Name                | Description                                                |
| :----------------------- | :--------------------------------------------------------- |
| `computeTopicPriorities` | weights sum to 1                                           |
| `computeTopicPriorities` | returns empty array for no input                           |
| `computeTopicPriorities` | ignores rows with zero comments                            |
| `computeTopicPriorities` | ranks dominant topic first (score 100)                     |
| `computeTopicPriorities` | scores negative topic correctly                            |
| `computeTopicPriorities` | zero engagement component when counts are zero             |
| `computeTopicPriorities` | breaks score ties by negativity, then frequency, then name |
| `computeTopicPriorities` | excludes topics below MIN_SUPPORT                          |
| `computeTopicPriorities` | keeps low-volume topics when nothing clears MIN_SUPPORT    |
| `computeTopicPriorities` | assigns consecutive ranks and maps display names           |
| `normalizeTopic`         | passes canonical topics through                            |
| `normalizeTopic`         | maps compound variants to canonical                        |
| `normalizeTopic`         | is case-insensitive                                        |
| `normalizeTopic`         | folds unknown/null to Other                                |
| `deriveTopicStatus`      | New when no tickets exist                                  |
| `deriveTopicStatus`      | Monitoring while active tickets exist                      |
| `deriveTopicStatus`      | Addressed only when all tickets are Resolved/Closed        |

_(...and so on for all test files...)_
