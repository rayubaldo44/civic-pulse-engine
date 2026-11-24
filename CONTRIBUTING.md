# Contributing

Civic Pulse Engine is a portfolio capstone maintained on a best-effort basis. Small bug fixes, accessible interaction improvements, tests, and documentation corrections are welcome. For large features or changes to the municipal workflow, open an issue to discuss scope before investing in a pull request. Acceptance and response times are not guaranteed.

## Development

Follow the showcase setup in [README.md](README.md). Use Node.js 22.23.1 and pnpm 12.4.2; do not add another package-manager lockfile. Work on a branch and keep changes focused.

Before submitting a pull request, run:

```sh
pnpm vitest run
pnpm check
pnpm format
pnpm lint
pnpm build
node scripts/check-audit-exceptions.mjs
pnpm audit --audit-level high
```

Include a description of the problem, the resulting behavior, and the checks you ran. Add a regression test for behavior changes where it provides useful coverage. Review formatting changes before committing.

## Data and test services

Use invented records and placeholder credentials in issues, screenshots, tests, and pull requests. Do not submit real citizen comments, staff records, document exports, annotation data, authentication state, or environment files. Public social-media text can still identify a person after author identifiers are hashed.

Unit tests do not require a live database. Integration and end-to-end tests create accounts and seed or delete records; run them only against an isolated local Supabase stack. Never point them at a hosted staff database. The separate NLP service and full ingestion pipeline are not part of the default contributor setup.

The retrieval fixture is an illustrative synthetic example. It does not establish model accuracy or match a deployed document corpus. Adapt it to independently created test documents before running retrieval evaluation; keep generated reports private until reviewed.

## Security and licensing

Report vulnerabilities privately using [SECURITY.md](SECURITY.md). Do not disclose exploit details in public issues.

By submitting a contribution, you agree that your original contribution may be distributed under this repository's MIT license. Preserve existing copyright and third-party notices, and identify licenses and sources for any new assets or dependencies.
