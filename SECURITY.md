# Security policy

If you discover a vulnerability, use GitHub's **Report a vulnerability** option on this repository's Security tab. Please avoid opening a public issue that includes exploit details, credentials, or personal information.

The maintainers will acknowledge a report, assess its impact, and coordinate a fix and disclosure. This capstone prototype is provided without a guaranteed response time or security support period.

Never include real citizen comments, staff records, database exports, or credentials in a reproduction. Use synthetic data and a separate test project.

## Dependency audit exception

As reviewed on 2026-11-24, GHSA-3r8g-jcqq-3p5j affects SvelteKit experimental remote functions. This project does not enable `kit.experimental.remoteFunctions` and contains no `.remote.js` or `.remote.ts` files. The advisory is excluded by ID from pnpm's audit, while CI explicitly checks those conditions and expires the exception on 2027-02-24. All other high and critical findings continue to fail the audit gate.

See the [upstream advisory](https://github.com/advisories/GHSA-3r8g-jcqq-3p5j). Remove this exception when adopting a patched framework version; do not enable remote functions without reassessing it. Lower-severity dependency advisories may remain and are not a claim of a clean security audit.
