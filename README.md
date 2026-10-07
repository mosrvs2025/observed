# OBSERVED

**Test the world yourself.** A distributed citizen observatory: pick an experiment, make a prediction, measure reality with your phone, and inspect the evidence — raw observations, open math, signed records.

```bash
npm start            # http://localhost:3000  (Node ≥ 22.13, zero npm dependencies)
npm test             # physics + integrity tests
npm run anchor       # write a signed ledger checkpoint to ./anchors/
```
First run seeds a **clearly-labelled simulated** equinox campaign (set `OBSERVED_SEED=0` to skip). Data lives in `./data` (SQLite + server key + photos); delete it to start over.

## What's in the MVP
| Experiment | Question |
|---|---|
| **The Shadow Stick** (Eratosthenes, with a phone) | Do shadows around the world fit a distant Sun over a round Earth, or a near Sun over a flat one? |
| **One Sunset, Everywhere** | Where is the Sun, geometrically, when it vanishes — and who predicts the second best? |

End-to-end for both: guided capture (GPS + accuracy, phone level & compass, clock sync, photo) → locked prediction → signed observation → reveal against every model → replication → structured challenges → evidence page with live-recomputable statistics.

## Principles → mechanics
- **Predictions before results.** Hypotheses are *parametric models* (`public/shared/models.js`), locked with a server timestamp. Scoreboards separate **blind** scores (observations that arrived after the lock) from **after-the-fact** fits, which are labelled as such. In capture, model predictions for your spot stay hidden until you've committed your own.
- **Evidence integrity.** Device-held ECDSA P-256 key signs canonical JSON → server verifies, stamps receive time, appends to a SHA-256 hash-chained ledger signed with Ed25519. SQLite triggers forbid UPDATE/DELETE; corrections are signed *amendments*. Every observation page has **Verify in my browser** (re-hash, signature, chain links). `GET /api/export/:slug` is the full signed dataset.
- **Blockchain only where it helps.** As an external *witness* for ledger checkpoints (`npm run anchor`, `external_ref`). The UI says "server-signed only" until one is attached.
- **Transparency.** Per-observation uncertainty budgets; bootstrap over *observers*; failed attempts, outliers, amendments, simulated data all shown and filterable; every assumption listed; the Evidence page lets you change the error floor / challenge handling / simulated-data inclusion and recomputes **in your browser** with the same code the server uses (`public/shared/analysis.js`).
- **Replication.** "I want to reproduce this" → guided run linked to the original; agreement is a z-score of reduced residuals against a shared yardstick.
- **Challenges, not comments.** Typed (bad GPS, tilted stick, refraction, unclear horizon, wrong calculation, alternative hypothesis…), with a proposed effect and a what-if sensitivity. Upheld at net +3 or on the observer's concession; changes the numbers only when upheld.
- **The Eratosthenes pair test uses no ephemeris**: noon pairs give a radius R (round) and a Sun height H (flat). R is consistent across pairs; H isn't.

## Layout
```
public/shared/   isomorphic science + integrity code (runs in Node AND the browser)
server/          http server, append-only store, validation, seed, anchor CLI
public/js/       vanilla-ES-module SPA (hash router, canvas globe, SVG charts, capture wizard)
test/            physics checks vs known values; integrity/tamper/forgery tests
```

## Honest limits
A signature proves *which device* sent *which bytes*, not that the shadow was real. Defences are statistical (independent observers, replication, plausibility checks, photos). Keys are free, so Sybil attacks are possible (votes are limited to contributors; results bootstrap over observers). The ephemeris is a model used as a yardstick. See `#/method` in the app.

## Roadmap
More experiments (Polaris altitude, Moon parallax, horizon dip, speed of sound, pressure vs altitude — listed as *proposed* with a real interest counter), offline capture queue, observer reputation, EXIF-free photo analysis helpers, external anchoring automation.
