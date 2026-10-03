# Development workflow

For each major change:

1. Create a GitHub issue describing the problem, scope and acceptance criteria.
2. Create a branch from the current main branch for that issue.
3. Commit each meaningful partial change using Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), then push the branch.
4. Open a pull request linking the issue with `Closes #number`.
5. Run appropriate tests and review the final diff for regressions, usability and private data.
6. Merge the reviewed pull request and start the next branch from updated main.

Do not commit local webhook setup, credentials, node_modules, generated browser artifacts or the original input archive. Package public ZIPs with scripts/package.ps1, which excludes private setup. See README.md for checks and installation.
