# FAF Site Deployment

As of 2026-07-28, Azure DevOps is the single deployment source for the FAF site.

## Architecture

```
ADO repo (origin) --push to main--> Azure Pipelines --> wrangler pages deploy --> Cloudflare Pages
                                                                                   (faf-site project)
GitHub (github-archive) -- read-only mirror, no deploy trigger
```

## How It Works

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

These must be created in ADO under Pipelines > Library > Variable Groups before the first pipeline run. Mark both as secret.

## Setup Checklist (one-time)

1. In ADO project "FAF Development", go to Pipelines and create a new pipeline pointing to `azure-pipelines.yml` in the repo root.
2. Create variable group `faf-cloudflare` in Pipelines > Library with the two secrets above.
3. Grant the pipeline access to the variable group.
4. Verify the first run deploys successfully to Cloudflare Pages.

## GitHub Mirror

The `github-archive` remote (`git@github.com:imjustfloyd85/faf-site.git`) is a read-only archive. The GitHub Actions workflow (`.github/workflows/deploy.yml`) is disabled (`if: false`). Do not re-enable it — all deploys go through ADO.

To sync the mirror after a release (optional):

```
git push github-archive main
```

## Manual Deploy

If the pipeline is unavailable, deploy manually from a machine with Wrangler installed:

```
cd /Volumes/NVMe/faf-site
export CLOUDFLARE_API_TOKEN=<token>
export CLOUDFLARE_ACCOUNT_ID=<account-id>
npx wrangler pages deploy . --project-name=faf-site --branch=main --commit-dirty=true
```

## Rollback

Cloudflare Pages retains previous deployments. To roll back:

1. Go to the Cloudflare dashboard > Pages > faf-site > Deployments.
2. Find the last-known-good deployment.
3. Click "Rollback to this deploy."
