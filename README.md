# Token Launch Radar

Entry for the make.fun **token-radar-01** bounty: a radar for token launches
that have not happened yet. It reads a sealed snapshot of every protocol
DefiLlama tracks, works out which ones still record no token, ranks them by
what their launch would be worth, and hands the reader a farm plan for each
one — plus a dashboard to browse the board.

## What it ranks

The board holds **200 rows**: the snapshot's 40-protocol watchlist (pre-token
protocols at or above the $50,000,000 TVL floor) plus the 160 pre-token
protocols below the floor with the most TVL. Every row is a protocol whose
DefiLlama record carries no token (`mcap_usd`, `gecko_id` and `symbol` all
null). Protocols whose token already trades are kept apart in the dashboard's
Live view, shown at their market cap, never mixed into the ranking.

## The model (radar-2)

Implied value follows only from the snapshot's own figures, never from a
protocol's name. The same function scores every row:

```
base         = tvl_usd x 0.18
growth       = clamp(change_7d, -50, 150) per cent
growthMult   = 1 + growth/100 x 0.60 when growth >= 0,
               1 + growth/100 x 0.90 when growth < 0
               (a falling TVL is punished harder than a rising one is rewarded)
maturity     = 0.55 + 0.45 x ln(1 + age_days) / ln(1 + 1460)
               (log age since listed_at; unknown age counts as 365 days)
breadth      = 1 + 0.03 x min(chains - 1, 5)
sector       = a small multiple by category family, 0.90 .. 1.10
implied      = max(1, round(base x growthMult x maturity x breadth x sector))
```

The model is deterministic: age is counted from the snapshot's `as_of` date,
so two runs write the same bytes. Rank 1 is the board's most valuable
protocol; implied value never rises as rank ascends.

## Farm plans

Each row carries 7 farm steps, generated from that protocol's own category,
chains, TVL, age and 7-day trend. Every step is concrete: what to do, what it
costs (deposit size, gas per chain) and how long it takes (minutes to hold for
30-90 days). No slogans, no hardcoded protocol names.

## The dashboard

A static page (`dashboard/`, no network, no framework) with a dark slate,
amber and teal theme. It sorts by any column, filters by text, category and
token status, and opens a detail panel for every protocol that recomputes its
implied value from the same model. Deep links work: `#/protocol/<slug>` opens
a protocol's detail view, `#/filter/<text>` opens a filtered board.

## Run it

Node 22 or later, standard library only, nothing to install:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

That writes `out/board.json`, `out/data.js`, `out/dashboard/` (copied from
this repo), `out/screenshots/` and `out/dossier.json`. Run it twice and the
two outputs are byte-identical.

## Layout

```
main.ts                  entrypoint: reads the snapshot, writes /output
lib/model.ts             the radar-2 model, the board builder, the farm plans
vendor/makefun-board.ts  make.fun's board library (buildDossier), unchanged
dashboard/               index.html, app.css, app.js (static, no network)
screenshots/             board, detail and filtered views (JPEG, 1440x900)
```

## License

MIT. See `LICENSE`.
