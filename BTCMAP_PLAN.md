# Plan: keep BTC Map honest from FreeHub's merchant records

Status: proposed for review (2026-10-21), from `zapabug/freehub` branch `proposal/btcmap-sync`. Steps 1 (template) and 2 (read-only dry run) are in this PR; the dry run has not been run against the team relay yet, and OSM writes are not built.

This file holds the decisions, the facts checked so far, the design and the steps, so someone can start from here without the conversation that produced it. It sits next to [RELAY_PLAN.md](RELAY_PLAN.md).

## Goal

BTC Map shows Madeira merchants from OpenStreetMap. Today what's on it drifts: places close, places stop accepting, places start accepting and nobody tags them. Our field team already records the truth in FreeHub's Merchants table every time they visit a shop, through Visitas.

This plan makes FreeHub the source and OSM the output. A small service reads the Merchants table every night and fixes the Bitcoin tags on each merchant's OSM node to match what the team saw. Once a month it also looks for merchants that tagged themselves on OSM and that we don't know about yet, and adds them to the table as leads to visit.

## Decisions

| Question | Decision |
| --- | --- |
| What decides a merchant's BTC Map state | The record's **Journey** stage, set by the team in FreeHub or in Visitas's visit sheet. Nothing else. |
| Field notes | Never parsed. Free text drives nothing. |
| FM24 list, BTC Map's current state | Not read as inputs. FM24 was a one-time import; BTC Map is what we're correcting. |
| Closed and moved shops | Two new stages on the Merchants pack, in this same PR: **Closed** (kind `lost`): the business is gone, its listing is deleted from OSM. **Relocated** (kind `open`): the business moved; the sync leaves it alone, and Visitas handles the move (the operator pins the new location, then Visitas relocates the OSM listing). |
| OSM node link | A new **OSM link** (url) field on the Merchants pack, in this same PR. The live table already has one from the CSV import; the template didn't. |
| Where the sync runs | A new service, `btcmap/`, beside `notifier/` and `connector/`, built and deployed the same way (its own `vite.config.ts`, `Dockerfile`, `btcmap:build` script). See [Why a new service](#why-a-new-service). |
| Its Nostr identity | Its own key, added as a member of the project that holds the Merchants table, like the connector's. Records are written as new versions by a member, so it can update `On BTC Map` on records others created. |
| Secrets | Environment variables on the server, read at start, failing loudly if missing: `BTCMAP_KEY` (nsec), `OSM_TOKEN` (OAuth 2 token of FREE Madeira's OSM account). No key files in the repo. |
| `On BTC Map` checkbox | Owned by the sync. It is rewritten after every nightly run to what OSM actually shows. |
| Schedules | Nightly at 23:00 Europe/Lisbon; discovery on the first Monday of the month, 09:00 Europe/Lisbon. In-process timers, like the notifier's. |
| OSM edits | The Bitcoin tags, plus the common public details FREE Madeira used to read **from** BTC Map with its old export tool (name, address, website; never phone), now written the other way: FreeHub → OSM. See [What gets written](#what-gets-written). A Closed business is removed from OSM: its node is deleted, or, when a building or relation uses the element, the business's tags are. One changeset per run. |
| A FreeHub heat map | Not in this plan. Visitas runs in a desktop browser and already has one. The detailed 3D map is untouched. |

## Journey stage → action

The stages are the Merchants pack's, from [`src/lib/crm-templates.ts`](src/lib/crm-templates.ts), plus the new one.

| Journey stage | OSM has the Bitcoin tags | OSM lacks them |
| --- | --- | --- |
| **Accepting bitcoin** | keep; refresh the check date (see [BLOCKING](#blocking)) | **add** the tags |
| **Not interested** | **remove** the tags | nothing |
| **Closed** | **remove the listing from OSM** (below) | **remove the listing from OSM** |
| **Relocated** | nothing (Visitas moves the listing) | nothing |
| Lead, Contacted, Interested, Onboarding | nothing | nothing |

**Not interested** takes the merchant off BTC Map and nothing else: the Bitcoin tags go, the business stays on OSM as it is.

**Closed** means the business is gone, so its listing comes off OSM:

- **A node that only holds the business** (the usual shop pin) is **deleted**. The sync first asks OSM whether any way or relation uses the node; OSM refuses to delete one that's in use.
- **Anything else** — a business drawn on a building outline, or a node a way or relation uses — can't be deleted without breaking the map, so the business's tags are removed instead (name, kind, hours, phone, website, contacts, cuisine, description, every payment tag) and only the premises' `addr:*`, `building*`, `level`, `entrance` and `indoor` tags stay.

OSM history keeps everything removed.

**Relocated** is not a removal. The business still exists somewhere else: the operator marks it Relocated in Visitas, pins the new location, and Visitas moves the OSM listing there. The sync never touches a Relocated merchant, and it only deletes when the stage is named exactly "Closed", so a stage named e.g. "Closed/relocated" can never delete a business that only moved.

Both are `lost` stages, so the sync tells them apart by label: a `lost` stage whose label starts with "Closed" is a closure. Until the live table has the stage, Visitas writes Not interested for closed shops, and those only lose their Bitcoin tags.

Rules around it:

- A record without an OSM link is skipped and counted in the run report, so the team can link it.
- A record that hasn't changed since the last run and whose OSM node hasn't either is skipped without an API call beyond the node read.
- If OSM rejects a write because the node changed meanwhile (version conflict), that merchant is skipped this run and tried again tomorrow. No retry loop.
- After the run, `On BTC Map` on each record is set to whether its node now carries the tags.

## What gets written

FREE Madeira's old export tool read Madeira merchants from BTC Map's API and kept `name`, `lat`/`lon`, `addr:street`, `addr:city`, `addr:postcode` and `phone`. The sync writes the public ones back, from the team's checked records, for merchants in **Accepting bitcoin**:

| OSM tag | From FreeHub | Rule |
| --- | --- | --- |
| `currency:XBT=yes` | Journey stage of kind `won` (Accepting bitcoin) | Added. Removed, together with `payment:lightning`, `payment:lightning_contactless`, `payment:onchain`, the deprecated `payment:bitcoin` and `check_date:currency:XBT`, when the stage is of kind `lost` (Not interested, Closed). |
| `payment:lightning`, `payment:onchain` | — | **Never added or changed** for an accepting merchant. FreeHub doesn't record which one a merchant takes, and OSM often does: one of the A Confeitaria nodes has `payment:onchain=no`, which must stay. |
| `check_date:currency:XBT` | Date of the newest visit | Lets BTC Map show the listing as verified on that date. |
| `name` | Record title | Written only if FreeHub's differs from OSM's. Fixes cases like the A Confeitaria branches. |
| `addr:street`, `addr:housenumber`, `addr:postcode`, `addr:city` | Address | Only if the address splits cleanly into those parts; otherwise left alone and listed in the run report. |
| `website` | Website | Written if set. |

Not written: **phone** (FreeHub's Phone is the team's contact number, often a person's own; it stays in the record and is never uploaded, and a phone already public on OSM is left as it is), contact person, email, and coordinates (moving a node is an OSM mapper's call, not a sync's).

A FreeHub field that's empty never clears the OSM tag: empty means "we don't know", not "remove it".

## Why a new service

The [`connector/`](connector/) moves data **into** FreeHub: its adapters (`connector/sources/types.ts`) read an outside source and its `Writer` writes records. It subscribes to tables, not records. Our nightly job goes the other way: it reads records and writes to OSM. Bending an adapter around that would make the connector's model harder to follow for both cases.

The [`notifier/`](notifier/) already does what we need structurally: a long-running service that reads the team relay with its own key, keeps state in a file, runs timers, and takes its config from environment variables (`notifier/config.ts`, `required()`). `btcmap/` copies that shape.

What it reuses rather than rebuilds:

- `TeamRelay` ([`src/lib/team-relay.ts`](src/lib/team-relay.ts)) to connect and authenticate.
- `resolveTables` and the record helpers in [`src/lib/crm.ts`](src/lib/crm.ts) to find the Merchants table and read records.
- `parseRecord` and `recordTemplate` (`src/lib/crm.ts`) and `mergeRecord` ([`connector/merge.ts`](connector/merge.ts)), the way [`connector/writer.ts`](connector/writer.ts) uses them, to publish a record with `On BTC Map` changed and nothing else.
- `parseLocation` / `locationValue` (`src/lib/location.ts`) for the Location of records created by discovery.

New code: reading the element type and id out of an OSM link (`openstreetmap.org/node/123`, `/way/…`). Nothing in the repo does that today.

## Monthly discovery

1. Query OpenStreetMap (Overpass API) for nodes and ways inside Madeira's bounding box carrying the Bitcoin tags.
2. Drop every result whose OSM link already sits on a Merchants record.
3. For each one left, create a record: title from the OSM `name`, Journey **Lead**, Location from its coordinates, OSM link set.
4. Report how many were added.

Leads are what the team already triages; a new one gets visited before anything is believed about it.

## Facts

Checked on this branch on 2026-10-20.

**FreeHub:**

- Merchants pack Journey stages (before this PR): Lead, Contacted, Interested, Onboarding, Accepting bitcoin (`won`), Not interested (`lost`). Stage kinds are `open`, `won`, `lost` (`src/lib/crm.ts`).
- Changing the template only shapes **new** projects. The live Merchant adoption table needs the **Closed** (kind Lost) and **Relocated** (kind Open) options added once by a project admin in the stage options editor. The sync reads each stage's kind: `won` = accepting, `lost` = take it off BTC Map, `open` = leave it alone. The one label it reads is "Closed", exactly, which is what makes a `lost` merchant's listing get deleted rather than only lose its Bitcoin tags.
- `On BTC Map` is a checkbox on the pack. `Accepting since` and `Next follow-up` are dates.
- The insights view counts `lost` stages as ended deals, so Closed will count there with Not interested.

**Visitas** ([freemadeira/visits](https://github.com/freemadeira/visits)):

- Its visit sheet writes the Journey stage when a visit is saved. A cycling button walks Lead → Contacted → Accepting bitcoin → Not interested; a separate ❌ button marks "Closed/relocated".
- Until FreeHub has the stage, that ❌ button writes **Not interested** (`JOURNEY_LABEL.closed` in `src/lib/freehub.ts`). Once this PR is in and the live table has the options, Visitas (a separate repo, maintained by FREE Madeira's merchant support) changes three things together:
  1. The ❌ button splits into **Closed** and **Relocated**, writing the new FreeHub stages.
  2. Tapping **Closed** asks for confirmation first — "This removes the place from OpenStreetMap and BTC Map" — because from then on that tap leads to the listing being deleted in that night's run.
  3. **Relocated** keeps the merchant visible; the operator pins the new location and Visitas moves the OSM listing there. That's Visitas's work, not this sync's.
- Visits are also published as comment events tagged `activity=visit`. The stage decides what happens; the sync reads visit events only for the date of the newest one (`check_date:currency:XBT`), never their text.
- The live table's `Address` field came from the CSV import, like `OSM link`; it isn't in the template. Address is free text, which is why it's only written to OSM when it splits cleanly.
- Visitas finds the OSM link by the field name `OSM link`.

**OSM / BTC Map:**

- BTC Map reads merchants from OSM, so editing OSM is how a listing changes. Our edits appear on BTC Map after its next import.
- Edits go through the OSM API 0.6 with an OAuth 2 token, inside a changeset, and each update must send the node's current version.
- Credentials: an OSM account owned by FREE Madeira. Its token is set as `OSM_TOKEN` on the server.

## First real cases

- **Ciao Pizza**: found closed on 2026-10-20. Its node is a standalone pin (no way or relation uses it, checked 2026-10-21), so once its record is on Closed the run deletes it from OSM. While it's still on Not interested (the Visitas bridge), only its Bitcoin tags go.
- **A Confeitaria branches**: some branches appear on OSM/BTC Map named "A Cafetaria […]". Four FM24 "A Confeitaria – X" entries still aren't linked to their FreeHub records. The sync doesn't rename anything on OSM; the fix is to link those records to the right OSM nodes, after which their stage drives them like any other.

## Open questions

### BLOCKING

None left.

_Settled 2026-10-21:_ ~~phone numbers~~: never written; FreeHub's Phone stays in the record. ~~The Bitcoin tag set~~: The sync writes the Bitcoin tags plus the common details the old BTC Map export read, in the other direction (see [What gets written](#what-gets-written)). Tag names to check against BTC Map's tagging guide before the first real write.

### Before the first OSM write

- **OSM's Automated Edits code of conduct.** An unattended service editing OSM is an automated edit: it has to be documented on the OSM wiki and announced to the local community (OSM Portugal) before it runs, and done from an account that says it's a bot. The account FREE Madeira provides should be a dedicated one (e.g. `FREE Madeira bot`), not a person's.

### DECIDE AT BUILD

- **The changeset comment.** Lean: `FREE Madeira: Bitcoin acceptance checked in person by our field team` plus `source=survey`.
- **Run report.** Lean: log to stdout (Coolify keeps it) with counts per action and the list of skipped records without an OSM link.

### LATER

- Opening hours, once FreeHub has a field for them.
- Reading self-published merchants from Nostr as a second discovery source.

## Steps

1. **Template (done on this branch).** Closed and Relocated stages and the OSM link field in the Merchants pack.
2. **Dry run (built on this branch, not yet run against the relay).** `btcmap/` reads the Merchants table and each merchant's OSM element and prints what it would change; `discover` lists bitcoin merchants on OSM in Madeira that no record links to. Nothing is written anywhere. To run it:
   1. `pnpm btcmap:build`, then `node btcmap/dist/btcmap.js key` for a new key; whitelist the npub on the team relay.
   2. Set `RELAY_URL`, `BTCMAP_KEY` and `BTCMAP_TABLE` (the Merchants table's address, `30305:<creator pubkey>:<table id>`).
   3. `node btcmap/dist/btcmap.js nightly` and `node btcmap/dist/btcmap.js discover`. With no command it waits for its schedule.

   Checked so far, against live OSM data: the decision logic on Ciao Pizzeria's node (as Closed: deleted, since nothing else uses the node; had it been in use, only its `addr:*` tags would stay; as Not interested: only the Bitcoin tags removed) and on an A Confeitaria node (only the check date and the name change; its `payment:onchain=no` stays), and the Overpass query (167 bitcoin merchants in Madeira on 2026-10-21).
3. **Writes on a short allowlist.** Ciao Pizza and the linked A Confeitaria records only. Check the result on OSM and, after its import, on BTC Map.
4. **Everything.** Allowlist removed; nightly run and monthly discovery on.
5. **PR** against `freemadeira/freehub` with all of the above, for the team to review, deploy on Coolify and own.

## References

- [`notifier/main.ts`](notifier/main.ts), [`notifier/config.ts`](notifier/config.ts): the service shape `btcmap/` copies.
- [`connector/writer.ts`](connector/writer.ts): how a member publishes a new version of a record.
- [`src/lib/crm-templates.ts`](src/lib/crm-templates.ts): the Merchants pack.
- Visitas: `src/lib/freehub.ts` (`JOURNEY_LABEL`, the `OSM link` field lookup) and `src/components/VisitSheet.tsx`, in [freemadeira/visits](https://github.com/freemadeira/visits).
- OSM API 0.6: <https://wiki.openstreetmap.org/wiki/API_v0.6>
- BTC Map: <https://btcmap.org/>
