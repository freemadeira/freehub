# Plan: keep BTC Map honest from FreeHub's merchant records

Status: proposed for review (2026-10-21), from `zapabug/freehub` branch `proposal/btcmap-sync`. Steps 1 (template) and 2 (read-only dry run) are in this PR; the dry run has not been run against the team relay yet, and OSM writes are not built.

This file holds the decisions, the facts checked so far, the design and the steps, so someone can start from here without the conversation that produced it. It sits next to [RELAY_PLAN.md](RELAY_PLAN.md).

## Goal

BTC Map shows Madeira merchants from OpenStreetMap. What's on it drifts: places close, move, stop accepting, start accepting, and nobody updates OSM.

The data flows one way, through three pieces:

- **Visitas**, FREE Madeira's field app (a separate repo), is where the team checks a merchant in person. It reads and writes only FreeHub: it sets the Journey stage, pins locations, and asks for confirmation before anything that removes a business from the map.
- **FreeHub's Merchants table** holds the result.
- **This sync** is the only thing that edits OSM. Every night it makes each merchant's OSM listing match its record. Once a month it lists bitcoin merchants on OSM in Madeira that no record links to, as leads to visit.

## Decisions

| Question | Decision |
| --- | --- |
| What decides a merchant's OSM listing | The record's **Journey** stage (plus its Location, Address, title and Website). Nothing else. |
| Who checks merchants | Visitas, in the field. The sync never judges a merchant; it acts on the stage it finds. |
| Who edits OSM | Only this sync. Visitas never talks to OSM. |
| Field notes | Never parsed. Free text drives nothing. |
| FM24 list, BTC Map's current state | Not read as inputs. FM24 was a one-time import; BTC Map is what we're correcting. |
| Closed and moved businesses | Two new stages on the Merchants pack, in this PR: **Closed** (kind `lost`): the business no longer exists, and the sync removes its listing from OSM. **Relocated** (kind `open`): the business moved; once its new location is pinned in Visitas, the sync moves the OSM listing there. |
| OSM node link | A new **OSM link** (url) field on the Merchants pack, in this PR. The live table already has one from the CSV import; the template didn't. |
| Where the sync runs | A new service, `btcmap/`, beside `notifier/` and `connector/`, built and deployed the same way (its own `vite.config.ts`, `Dockerfile`, `btcmap:build` script). See [Why a new service](#why-a-new-service). |
| Its Nostr identity | Its own key, whitelisted on the relay and added to the project that holds the Merchants table, so it can read records and, later, update `On BTC Map` on them. |
| Secrets | Environment variables on the server, read at start, failing loudly if missing: `BTCMAP_KEY` (nsec), and for the write step `OSM_TOKEN` (OAuth 2 token of FREE Madeira's OSM account). No key files in the repo. |
| `On BTC Map` checkbox | Owned by the sync: set after each run to whether the listing carries the Bitcoin tags. |
| Schedules | Nightly at 23:00 Europe/Lisbon; discovery on the first Monday of the month, 09:00 Europe/Lisbon. In-process timers, like the notifier's. |
| A FreeHub heat map | Not in this plan. Visitas runs in a desktop browser and already has one. The detailed 3D map is untouched. |

## Journey stage → what the sync does on OSM

| Journey stage | Kind | On OSM |
| --- | --- | --- |
| **Accepting bitcoin** | `won` | Add `currency:XBT=yes` and `check_date:currency:XBT` (last visit); update name, website and address from the record ([What gets written](#what-gets-written)). |
| **Not interested** | `lost` | Remove the Bitcoin tags. The business stays on OSM as it is. |
| **Closed** | `lost` | Remove the listing (below). |
| **Relocated** | `open` | Move the listing to the record's Location, once it's been re-pinned (below). Bitcoin tags untouched. |
| Lead, Contacted, Interested, Onboarding | `open` | Nothing. |

The sync goes by each stage's kind, plus two exact labels: only a stage labelled **Closed** removes a listing and only one labelled **Relocated** moves one, so renaming or adding stages can't delete or move anything by accident.

**Closed: removing the listing.** The business no longer exists.

- A node that only holds the business (the usual shop pin) is **deleted**. The sync first asks OSM whether any way or relation uses the node; OSM won't delete one that's in use.
- Anything else (a business drawn on a building outline, or a node a way or relation uses) can't be deleted without breaking the map, so the business's tags are removed instead (name, kind, hours, phone, website, contacts, cuisine, description, every payment tag), and only the premises' `addr:*`, `building*`, `level`, `entrance` and `indoor` tags stay.

**Relocated: moving the listing.** The business still exists, somewhere else. The operator marks it Relocated in Visitas and pins the new spot there; Visitas writes the new Location (and Address, if known) to the record.

- Until it's re-pinned, the record's Location is still the OSM pin's, so nothing happens.
- Once the record's Location is more than **25 m** from the OSM pin, the sync moves the node there and updates `addr:*` from the record's Address when it splits cleanly. After that the two match again, so it doesn't move twice.
- Only a node nothing else uses is moved. A business on a building outline, or on a node a way or relation uses, is listed in the run report for a mapper to move by hand.

OSM history keeps everything removed or moved.

Rules around it:

- A record without an OSM link is skipped and listed in the run report, so the team can link it.
- If OSM rejects a write because the element changed meanwhile (version conflict), that merchant is skipped this run and tried again tomorrow. No retry loop.
- A FreeHub field that's empty never clears an OSM tag: empty means "we don't know", not "remove it".

## What gets written

FREE Madeira's old export tool read Madeira merchants from BTC Map's API and kept `name`, `lat`/`lon`, `addr:street`, `addr:city`, `addr:postcode` and `phone`. The sync writes the public ones back, the other way:

| OSM tag | From FreeHub | Rule |
| --- | --- | --- |
| `currency:XBT=yes` | Stage of kind `won` | Added. Removed, together with `payment:lightning`, `payment:lightning_contactless`, `payment:onchain`, the deprecated `payment:bitcoin` and `check_date:currency:XBT`, for a stage of kind `lost`. |
| `payment:lightning`, `payment:onchain` | — | Never added or changed for an accepting merchant. FreeHub doesn't record which one a merchant takes, and OSM often does: one of the A Confeitaria nodes has `payment:onchain=no`, which must stay. |
| `check_date:currency:XBT` | Date of the newest visit | Lets BTC Map show the listing as verified on that date. Never moved backwards. |
| `name` | Record title | Accepting merchants, when FreeHub's differs from OSM's. |
| `addr:street`, `addr:housenumber`, `addr:postcode`, `addr:city` | Address | Accepting or relocated merchants, only when the address splits cleanly into those parts; otherwise left alone and listed in the run report. |
| `website` | Website | Accepting merchants, when set. |
| node position | Location | Relocated merchants only, as above. |

Never written: **phone** (FreeHub's Phone is the team's contact number, often a person's own; it stays in the record, and a phone already public on OSM is left alone), contact person, email.

## Why a new service

The [`connector/`](connector/) moves data **into** FreeHub: its adapters (`connector/sources/types.ts`) read an outside source and its `Writer` writes records. Our job goes the other way: it reads records and writes to OSM. Bending an adapter around that would make the connector's model harder to follow for both cases.

The [`notifier/`](notifier/) already has the shape we need: a long-running service that reads the team relay with its own key, runs timers, and takes its config from environment variables (`notifier/config.ts`, `required()`). `btcmap/` copies it.

What it reuses rather than rebuilds:

- `TeamRelay` ([`src/lib/team-relay.ts`](src/lib/team-relay.ts)) to connect and authenticate.
- `resolveProject` and `parseProject` ([`src/lib/crm.ts`](src/lib/crm.ts), [`src/lib/project.ts`](src/lib/project.ts)) to find the Merchants table and its records.
- `readLocation` ([`src/lib/location.ts`](src/lib/location.ts)) for the records' Location.
- For the write step: `parseRecord` and `recordTemplate` (`src/lib/crm.ts`) and `mergeRecord` ([`connector/merge.ts`](connector/merge.ts)), the way [`connector/writer.ts`](connector/writer.ts) uses them, to publish a record with `On BTC Map` changed and nothing else.

New code, all in `btcmap/`: reading the element type and id out of an OSM link (`openstreetmap.org/node/123`), the OSM and Overpass reads (`osm.ts`), and the rules above as pure functions (`plan.ts`).

## Monthly discovery

1. Query OpenStreetMap (Overpass API) for nodes and ways in Madeira and Porto Santo carrying the Bitcoin tags.
2. Drop every result whose OSM link already sits on a Merchants record.
3. List the rest: name, OSM link, coordinates. In the write step, each becomes a record on Journey **Lead**, with its Location and OSM link, for the team to visit.

## Facts

Checked on this branch, 2026-10-20 and 2026-10-21.

**FreeHub:**

- Merchants pack Journey stages before this PR: Lead, Contacted, Interested, Onboarding, Accepting bitcoin (`won`), Not interested (`lost`). Stage kinds are `open`, `won`, `lost` (`src/lib/crm.ts`).
- Changing the template only shapes **new** projects. On the live Merchant adoption table, Visitas makes sure the **Closed** (kind Lost) and **Relocated** (kind Open) options exist.
- `Location` is stored as `"lat,lng"` (`src/lib/location.ts`). `On BTC Map` is a checkbox (`["true"]` or nothing).
- The insights view counts `lost` stages as ended deals, so Closed counts there with Not interested.

**Visitas** ([freemadeira/visits](https://github.com/freemadeira/visits)), a separate app:

- Its visit sheet writes the Journey stage when a visit is saved. Today a single ❌ button marks "Closed/relocated" and writes **Not interested** (`JOURNEY_LABEL.closed`), as a bridge until FreeHub has the stages.
- Visitas's side of this plan, in Visitas itself: make sure the live table has Closed and Relocated; split the ❌ button into **Closed** and **Relocated**; before Closed, say clearly "This removes the business from the map"; for Relocated, keep the merchant visible and let the operator pin the new location.
- Visits are also published as comment events tagged `activity=visit`. The sync reads them only for the date of the newest one, never their text.
- The live table's `Address` and `OSM link` fields came from the CSV import. Address is free text, which is why it's only written to OSM when it splits cleanly.

**OSM / BTC Map:**

- BTC Map reads merchants from OSM, so editing OSM is how a listing changes; our edits appear on BTC Map after its next import.
- Edits go through the OSM API 0.6 with an OAuth 2 token, inside a changeset, and each update or delete sends the element's current version.

## First real cases

- **Ciao Pizza**: found closed on 2026-10-20. Its node is a standalone pin (no way or relation uses it, checked 2026-10-21), so once its record is on Closed the sync deletes it from OSM. While it's on Not interested (the Visitas bridge), only its Bitcoin tags go.
- **A Confeitaria branches**: some appear on OSM as "A Cafetaria […]", and four FM24 "A Confeitaria – X" entries aren't linked to their FreeHub records yet. Once linked, an accepting branch's OSM name is corrected from its record's title.

## Open questions

### Before the first OSM write

- **OSM's Automated Edits code of conduct.** An unattended service editing OSM is an automated edit: it has to be documented on the OSM wiki and announced to the local community (OSM Portugal) before it runs, from an account that says it's a bot. The OSM account FREE Madeira provides should be a dedicated one (e.g. `FREE Madeira bot`), not a person's.
- **Tag names** checked against BTC Map's tagging guide.

### DECIDE AT BUILD (write step)

- **The changeset comment.** Lean: `FREE Madeira: checked in person by our field team` plus `source=survey`.
- **Run report.** Lean: stdout (Coolify keeps it), as the dry run does now.

### LATER

- Opening hours, once FreeHub has a field for them.
- Reading self-published merchants from Nostr as a second discovery source.

## Steps

1. **Template (this PR).** Closed and Relocated stages and the OSM link field in the Merchants pack.
2. **Dry run (this PR, not yet run against the relay).** `btcmap/` reads the Merchants table and each merchant's OSM element and prints what it would add, remove, delete and move; `discover` lists bitcoin merchants on OSM in Madeira that no record links to. Nothing is written anywhere. To run it:
   1. `pnpm btcmap:build`, then `node btcmap/dist/btcmap.js key` for a new key; whitelist the npub on the team relay.
   2. Set `RELAY_URL`, `BTCMAP_KEY` and `BTCMAP_TABLE` (the Merchants table's address, `30305:<creator pubkey>:<table id>`).
   3. `node btcmap/dist/btcmap.js nightly` and `node btcmap/dist/btcmap.js discover`. With no command it waits for its schedule.

   Checked against live OSM data: Ciao Pizzeria's node (Closed: deleted, nothing else uses it; Not interested: only the Bitcoin tags removed; Relocated: no move while the pin is unchanged, a move with the new address once pinned ~200 m away, "by hand" if the node were shared), an A Confeitaria node (only the check date and name change; its `payment:onchain=no` stays), and the Overpass query (167 bitcoin merchants in Madeira on 2026-10-21).
3. **Writes on a short allowlist.** Ciao Pizza and the linked A Confeitaria records only. Check the result on OSM and, after its import, on BTC Map.
4. **Everything.** Allowlist removed; nightly run and monthly discovery on.

## References

- [`notifier/main.ts`](notifier/main.ts), [`notifier/config.ts`](notifier/config.ts): the service shape `btcmap/` copies.
- [`connector/writer.ts`](connector/writer.ts): how a member publishes a new version of a record.
- [`src/lib/crm-templates.ts`](src/lib/crm-templates.ts): the Merchants pack.
- Visitas: `src/lib/freehub.ts` (`JOURNEY_LABEL`, the `OSM link` field lookup) and `src/components/VisitSheet.tsx`, in [freemadeira/visits](https://github.com/freemadeira/visits).
- OSM API 0.6: <https://wiki.openstreetmap.org/wiki/API_v0.6>
- BTC Map: <https://btcmap.org/>
