# Deploying OBSERVED to Fly.io

One small always-on machine + one 1 GB volume (~$3/month; Fly has no free tier — see fly.io/docs/about/pricing).

```bash
# 1. install + log in (once)
curl -L https://fly.io/install.sh | sh        # or: brew install flyctl
fly auth login

# 2. from the repo root: register the app using the checked-in config
fly launch --no-deploy --copy-config          # pick a unique app name; say NO to a database/Redis

# 3. create the volume (must match [mounts] in fly.toml) and deploy ONE machine
fly volumes create observed_data --size 1 --region iad -y
fly deploy --ha=false

# 4. open it
fly open
fly logs                                       # watch startup / seeding
```

## Important
- **One machine only.** SQLite is single-writer; don't `fly scale count 2`.
- **Back up `/data`** — it holds the ledger, photos and the **server signing key** (`server-key.json`). Losing the key breaks verification of old receipts.
  `fly volumes snapshots list` / `fly ssh sftp get /data/observed.db` (snapshots are automatic daily).
- **Set a spending alert** in the Fly dashboard (Billing).
- **Demo data:** `fly secrets set OBSERVED_SEED=0` is *not* needed — the seed only runs on an empty ledger. To start clean, remove it from `[env]` before the first deploy.
- **Vercel:** you don't need it — the Fly URL serves the whole app. (To keep a Vercel domain, add a `vercel.json` rewrite of `/(.*)` to `https://<app>.fly.dev/$1`.)
- **Camera/GPS require HTTPS** — Fly provides it automatically.
