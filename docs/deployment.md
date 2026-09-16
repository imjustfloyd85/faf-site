# FAF Site Deployment

Last updated: 2026-09-16 (ADO #1241)

## Architecture

```
ADO repo (origin) --push to main--> Azure Pipelines --> wrangler pages deploy --> Cloudflare Pages
                                                                                   (faf-site project)
GitHub (github-archive) -- read-only mirror, no deploy trigger
```

ADO is the single source of truth for code and deployments. GitHub is a passive archive only.

## How it works

1. All code changes go through ADO pull requests targeting `main`.
2. On merge to `main`, the Azure Pipeline (`azure-pipelines.yml`) triggers automatically.
3. The pipeline installs Node 20 + Wrangler CLI, then runs `wrangler pages deploy .` against the `faf-site` Cloudflare Pages project.
4. Cloudflare serves the site from its edge network.

## Secrets

The pipeline uses an ADO variable group named `faf-cloudflare` containing:

| Variable        | Purpose                                     |
| --------------- | ------------------------------------------- |
| `CF_API_TOKEN`  | Cloudflare API token scoped to Pages deploy |
| `CF_ACCOUNT_ID` | Cloudflare account identifier               |

Both must be marked as secret in ADO.

## One-time setup (Floyd)

These steps must be completed before the first ADO pipeline run. Do them in order:

1. Go to ADO project "FAF Development" > Pipelines > Library.
2. Create a variable group named `faf-cloudflare`.
3. Add `CF_API_TOKEN` (the same Cloudflare API token currently stored in the GitHub repo secret `CF_API_TOKEN`). Mark as secret.
4. Add `CF_ACCOUNT_ID` (same value as GitHub's `CF_ACCOUNT_ID`). Mark as secret.
5. Go to Pipelines > New Pipeline > Azure Repos Git > select the repo > Existing Azure Pipelines YAML file > choose `azure-pipelines.yml` from the root.
6. On the first run, ADO will prompt to authorize the variable group. Approve it.
7. Verify the first run deploys successfully to Cloudflare Pages (check https://friscoathleticsfoundation.org).
8. After a successful ADO deploy, the GitHub Actions workflow is already disabled (`if: false`). No further action needed on the GitHub side.

## GitHub archive mirror

The `github-archive` remote (`git@github.com:imjustfloyd85/faf-site.git`) is a read-only archive. The GitHub Actions deploy workflow (`.github/workflows/deploy.yml`) is permanently disabled.

To sync the mirror after a release (optional, done from a local machine):

```bash
git push github-archive main
```

This keeps the GitHub copy up to date for reference but has no deploy effect.

## Manual deploy (emergency fallback)

If the ADO pipeline is unavailable, deploy from a local machine with Wrangler installed:

```bash
cd /Volumes/NVMe/faf-site
# Pull CF_API_TOKEN and CF_ACCOUNT_ID from macOS Keychain or ADO variable group
export CLOUDFLARE_API_TOKEN=<token>
export CLOUDFLARE_ACCOUNT_ID=<account-id>
npx wrangler pages deploy . --project-name=faf-site --branch=main --commit-dirty=true
```

Do NOT re-enable the GitHub Actions workflow. If ADO is down, use this local fallback.

## KV namespace seeding (one-off scripts)

The `scripts/seed-sponsor-leads.js` script can be run locally to seed KV data:

```bash
node scripts/seed-sponsor-leads.js --generate-only
npx wrangler kv bulk put scripts/.seed-bulk.json \
  --namespace-id f2ced3e931084f4f80a99fe53a1f744f --remote
```

The GitHub Actions workflow for this (`seed-sponsor-leads.yml`) has been removed. Run locally when needed.

## Rollback

Cloudflare Pages retains previous deployments. To roll back:

1. Go to the Cloudflare dashboard > Pages > faf-site > Deployments.
2. Find the last-known-good deployment.
3. Click "Rollback to this deploy."

## What changed (ADO #1241)

- GitHub Actions deploy workflow disabled permanently (`if: false`, renamed to `[DEPRECATED]`)
- GitHub Actions seed-sponsor-leads workflow removed (run locally instead)
- Azure Pipelines YAML hardened with header comment and post-deploy note
- This doc updated to reflect actual current state and one-time setup steps
- `wrangler.toml` and Cloudflare bindings unchanged (they remain the source of truth for runtime config)
