# Contributing

Academic Publication Tracker welcomes improvements to research workflows, data quality, accessibility, source integrations, and documentation.

1. Open an issue for significant changes so the scope can be discussed.
2. Install Node.js 24 LTS and run `npm ci`.
3. Create a branch and make a focused change.
4. Run `npm run typecheck`, `npm test`, and `npm run test:e2e` (run `npx playwright install chromium` once).
5. Run `npm run format:check` and `npm run test:desktop`, then `npm run desktop` to check the application interactively.
6. Submit a pull request describing the behavior, relevant checks, and any limitations.

Source adapters belong in `src/services`; calculation and import/export logic belongs in `src/core`; privileged desktop operations belong in `electron`. Keep API keys out of fixtures, logs, URLs shown to users, and pull requests. Use mocked responses for deterministic tests; keep live API calls explicit and small.

Every bibliometric change must explain its denominator, handling of missing values, source coverage, and deduplication behavior. Do not add citation counts from different indexes together. New integrations must use a documented API or an explicitly permitted data-access method.

Changes to IPC, file import, external URLs, or credentials need corresponding boundary tests. New UI features should remain usable with a keyboard and work at the minimum supported window size on both operating systems.

By contributing, you agree that your contributions are provided under the project's MIT license.
