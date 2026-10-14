# Plan: our own team relay, a fork of Haven

Status: planned, not started (2026-10-10). Nothing has changed in Freehub or on the relay yet.

This file holds the decisions, the facts checked so far, the design and the steps, so someone can start from here without the conversation that produced it. It sits next to [CONNECTOR_PLAN.md](CONNECTOR_PLAN.md), which depends on phase 0 here.

## Goal

Freehub keeps all its data on one Nostr relay, and today that relay is [Haven](https://github.com/barrydeen/haven) as released. We fork Haven, run the fork on our Coolify server in place of the current build, fix the problems Haven has, and add what Freehub needs, such as relay-enforced roles and per-project access.

The fork stays a Haven: same database, same data, same `/private` URL. The app keeps working through every step. Changes that help every Haven user go back upstream.

## Decisions

| Question | Decision |
| --- | --- |
| Fork or write our own | Fork Haven. Keep its Go code, its database and its upstream history. |
| Language | Stay in Go. Rewriting in Rust or TypeScript fixes nothing on the list below. |
| Where it lives | A **private** GitHub repository under the organization's account, made from Haven's history (not GitHub's "Fork" button, see [Repository](#repository)). Made public once upstream has the security fix. |
| Name | To decide. This plan uses `<org>/haven`. |
| Starting point | Haven **v1.2.2**, the version running now, so phase 0 changes nothing but the fixes. Upstream `master` is taken in later, on purpose (see [Upstream](#upstream)). |
| Freehub-specific code | In its own files, switched on by configuration, so the fork stays easy to rebase and generic Haven users are unaffected. |
| How it's deployed | An image built by GitHub Actions and pulled by Coolify by tag. Rolling back means picking the previous tag. |
| Data | Never migrated in place. Phase 0 keeps the same database engine and library versions, so the files on the volume stay as they are. |

## Why fork

Every item below was checked in Haven v1.2.2's source (`init.go`, `config.go`, `policies.go`) and khatru v0.19.1's (`responding.go`, `handlers.go`, `listener.go`, `helpers.go`). The first two were also confirmed live against our relay on 2026-10-08, with harmless probes.

**Security**

1. **Anyone can stream new private events.** khatru returns early for a REQ with `limit: 0`, before the `RejectFilter` checks that hold Haven's login and whitelist rules, and still registers a live listener. Haven sets no `PreventBroadcast`. So anyone who knows the URL can open a socket, send `["REQ","x",{"limit":0}]` and receive every card, record, doc and, once the connector runs, every order with the customer's name and email. Stored history is not exposed. `/chat` has the same gap.
2. **COUNT needs no login.** Haven enables NIP-45 COUNT but sets no `RejectCountFilter`, so anyone can count events matching any filter.
3. **Rate limits can be dodged, or shared by everyone.** khatru keys its limiters on the first public address in `X-Forwarded-For`, which a client can write itself. Without that header, every client behind the proxy shares one address.

Both holes are still on upstream `master` (`60b58ea`, 2026-08-26) and not reported upstream yet. The report text is ready; see [Upstream](#upstream).

**Built for one person, used by a team**

4. **One whitelist for everything.** Anyone on it can read every board and project, with any Nostr client. Who can edit and who can only view is enforced only by the app.
5. **Whitelist changes need a restart.** `WHITELISTED_NPUBS_FILE` is read once at startup.
6. **Limits per IP that don't fit a team:** 50 events a minute (burst 100) and 3 new connections per 5 minutes (burst 9). They throttle CSV imports, the connector and offices behind one IP.
7. **Unused relays exposed.** Outbox, inbox, chat and Blossom all run next to `/private`. Freehub uses none of them, and our media lives in a separate blossom-server. Haven's Blossom serves every file publicly and reads a whole upload into memory, with no size cap.

**Maintenance**

8. **khatru is archived.** Haven depends on `github.com/fiatjaf/khatru` v0.19.1, whose repository now points to `fiatjaf.com/nostr/khatru`, with a slightly different API.
9. **No safety net we trust yet.** The relay was wiped twice before 2026-10-08, when `/app/db` moved to a volume and hourly S3 backups started. A restore has never been tested.

## Facts

**Our deployment** (checked 2026-10-08):

- Coolify 4.3.23 on host `freehub` (2.28.100.229), which also serves the app at hub.freemadeira.org.
- The relay is the Coolify app `ufzo7fydle9nzjsqrwt6ddlk`: an inline Dockerfile that clones Haven v1.2.2 from git and builds it. It runs `./haven` as root in `/app`, on port 3355, behind Coolify's proxy, at `wss://relay.freemadeira.org/private`.
- Volume `ufzo7fydle9nzjsqrwt6ddlk-haven-db` is mounted at `/app/db`, and survived a redeploy test. `whitelisted_npubs.json` is a file mount.
- Environment: `DB_ENGINE=badger`, `BACKUP_PROVIDER=s3`, hourly, to the `freemadeira-backups` bucket (versioned, old versions kept 30 days). Hetzner server backups are on.
- Media is a separate app (blossom-server at media.freemadeira.org), not Haven's Blossom.

**Haven's code:**

- About 2,000 lines of Go in v1.2.2: `init.go` sets up the four relays, `config.go` reads the environment, `limits.go` the limits, `policies.go` the whitelist and web-of-trust checks, `backup.go` and `import.go` the S3 backup and imports. MIT licensed.
- Dependencies: khatru v0.19.1 (archived), eventstore v0.17.5 (Badger or LMDB), Go 1.24.
- The Badger store answers at most 1000 events per request, 250 when the request has no `limit`. Tag values over 100 characters aren't indexed, which is why Freehub uses 16-character `d` tags.
- khatru supports negentropy (NIP-77) behind a `Negentropy` flag, which Haven leaves off.

**Upstream since v1.2.2** (5 commits on `master`, no release yet):

- `#125` .onion relay URLs, `#128` README, `#129` fails cleanly on a malformed config.
- `#133` the owner can delete any event.
- `#135` (13,000 lines): a NIP-86 management API with an `/admin` console, a notes browser and a dashboard. Among other things it adds `allowpubkey`/`banpubkey`, which change the whitelist without a restart. Only `OWNER_NPUB` can use it; access can't be delegated. Its state lives in `management.json`.

**What Freehub sends the relay** ([src/lib/model.ts](src/lib/model.ts)):

- Kinds 0, 5, 7, 1111 and 30301–30310.
- Every read logs in first (NIP-42), including its `limit: 0` live feeds ([src/lib/relays.ts](src/lib/relays.ts)), so the security fixes don't affect it.
- It uses neither COUNT nor negentropy.

## Repository

1. Create an empty **private** repository, `<org>/haven`. GitHub's "Fork" button can't make a private fork of a public repository, and a public fork would publish the security fix before upstream has it.
2. Mirror Haven into it: `git clone --bare https://github.com/barrydeen/haven`, then `git push --mirror` to the new repository. Add Haven as the `upstream` remote.
3. Branches:
   - `master` mirrors upstream and is never committed to;
   - `freehub` is our main branch, started from tag `v1.2.2`.
4. Tags: `v1.2.2-freehub.1`, `.2`, and so on. A rebase onto a newer upstream release starts a new series, such as `v1.3.0-freehub.1`.
5. Keep Haven's `LICENSE` and copyright. Add a short "About this fork" part at the top of the README: what changed, and where to report problems.
6. Once upstream has the security fix, make the repository public, so other teams running Freehub can use it.

## Principles

- **Same data, always.** No change to the database engine, its library versions or the event format without a planned migration (see [Later](#later)).
- **Small diff against upstream.**
  - Generic fixes are separate commits, written so they can go upstream as they are.
  - Freehub's rules live in their own files (`freehub_*.go`), behind `FREEHUB_RULES=true`.
- **Config, not code, for our deployment.** Everything specific to FREE Madeira stays in Coolify's environment and mounted files.
- **Every change ships with a test.** Haven has almost none today, so each phase adds Go tests for its own rules.

## Phases

### Phase 0: fork, fix, build, switch over

Goal: the same relay, built from our repository, with the two holes closed. Nothing else changes.

1. Set up the repository as above.
2. **Security fix**, in `init.go`, for `privateRelay` and for `chatRelay` (with its web-of-trust check):
   ```go
   privateRelay.RejectCountFilter = append(privateRelay.RejectCountFilter,
   	policies.MustAuth, MustBeWhitelistedToQuery)
   privateRelay.PreventBroadcast = append(privateRelay.PreventBroadcast,
   	func(ws *khatru.WebSocket, _ *nostr.Event) bool {
   		_, ok := config.WhitelistedPubKeys[ws.AuthedPublicKey]
   		return !ok
   	})
   ```
   The hook types and the `AuthedPublicKey` field were checked against khatru v0.19.1. The code hasn't been compiled yet.
3. **Tests** for both holes: an unauthenticated `limit: 0` REQ receives nothing published afterwards; an unauthenticated COUNT is refused; a whitelisted, logged-in client still gets both.
4. **Dockerfile** in the repository: build with the Go version in `go.mod`, run as a non-root user, keep `/app` as the working directory and `/app/db` as the data folder, so the existing volume and file mounts fit unchanged.
5. **GitHub Actions:** on every push to `freehub`, run `go vet` and `go test`. On every tag, build the image and push it to the GitHub Container Registry as `ghcr.io/<org>/haven:<tag>`, private while the repository is.
6. **Rehearse on a copy:**
   - restore the latest `haven_backup.zip` into a scratch relay running the new image;
   - point a local Freehub at it;
   - check boards, tables, docs and the connector;
   - run the hole tests against it.

   This also tests the backup restore for the first time.

7. **Switch over** (see [Switching over](#switching-over)).
8. **Report upstream** (see [Upstream](#upstream)).

### Phase 1: run it like a team relay

Goal: fix what hurts day to day, still without Freehub-specific rules. Each item is a generic fix that can go upstream.

1. **Team mode.** `RELAYS=private` turns off outbox, inbox, chat, Blossom and their pages, and turns COUNT off on `/private`, since Freehub doesn't use it. Fewer ways in.
2. **Real client addresses.** `TRUSTED_PROXIES` (default: none): `X-Forwarded-For` is read from the right, skipping only addresses that belong to those proxies. Without it, the connection's own address is used. For us, that's Coolify's proxy network.
3. **Limits per person.**
   - Once logged in with a whitelisted key, limits apply per key rather than per address, with higher defaults suited to a team.
   - Logged-out connections keep strict per-address limits.
   - `KEY_LIMITS` sets other limits for given keys, for example a connector backfilling orders.
4. **Whitelist without restarts.** Re-read `WHITELISTED_NPUBS_FILE` when it changes on disk, and keep the last good copy if the new one doesn't parse. Upstream's NIP-86 `allowpubkey` (`#135`) does more, but it's large and unreleased; we take it in phase 3 (see [Upstream](#upstream)), and file reloading stays useful next to it.
5. **Health check:** `GET /health` answers once the database is open, for Coolify.
6. **Backups we trust.**
   - Keep the hourly S3 export, and add its time and size to the logs.
   - Write a restore runbook in the fork's docs, and repeat the phase 0 rehearsal every quarter.
   - Add an alert when a backup fails.
7. **Logs that help:** one line per refused REQ, EVENT or AUTH, with the reason, the key and the address. No event content.

### Phase 2: Freehub's write rules

Goal: the relay itself refuses changes the app would ignore. Viewers become read-only for real, and a connector can only write where a table lets it. Switched on by `FREEHUB_RULES=true`.

1. **Membership index.** In memory, rebuilt at startup from the stored events and kept up to date as events arrive:
   - each project's and board's members and viewers, from its latest event and its `p` tags (as `parseMembership` in [src/lib/model.ts](src/lib/model.ts));
   - which tables let which connectors write (`p` tags on the table's latest version from any project member, as `resolveTables` in [src/lib/crm.ts](src/lib/crm.ts));
   - deleted projects and boards.
2. **Rules** when an event arrives, after the whitelist check:

   | Kind | Accepted from |
   | --- | --- |
   | 0 | anyone whitelisted (their own profile) |
   | 30301 board, 30304 project | anyone whitelisted for a new one; afterwards only its creator, the event's author |
   | 30302 card, 30303 sprint | members of the board in its `a` tag |
   | 30305 table, 30307 doc page, 30309 Drive folder, 30310 Drive file | members of the project in its `a` tag |
   | 30306 record | members of the project, or a connector the table lets write |
   | 30308 source | anyone whitelisted (a connector's own manifest) |
   | 1111 comment | members of the board or project the commented card, record or Drive file belongs to |
   | 7 reaction | members of the board the card it reacts to, or the card of the comment it reacts to, belongs to |
   | 5 deletion | anyone whitelisted, for their own events, as NIP-09 already limits |

   A refusal answers `restricted: ` and the reason, which the app already shows as "the relay refused this".

3. **Shared test cases.** The same rules live in TypeScript in Freehub and in Go in the fork, so they must not drift:
   - write them as a contract: [Relay contract](#relay-contract) below, kept in Freehub as `docs/relay-contract.md`;
   - write test cases as data, events plus the expected answer, in Freehub as `relay-contract/cases.json`;
   - Freehub's tests run them against `src/lib`, and the fork's CI runs them against the Go rules, from a pinned Freehub commit.
4. **App changes:** none needed. The app already ignores what these rules refuse. Optionally, hide edit controls sooner when the relay refuses.

### Phase 3: Freehub's read rules (per-project access)

Goal: being on the whitelist lets you in, but you only read the projects and boards you're on. This makes it safe to add partners, guests and viewers to one relay. It's the biggest change and depends on phase 2's index.

1. **Who reads what:**

   | Kind | Readable by |
   | --- | --- |
   | 0, 30308, 5 | anyone whitelisted |
   | 30304 project, 30301 board | its members and viewers |
   | 30302, 30303 | the board's members and viewers |
   | 30305, 30306, 30307, 30309, 30310 | the project's members and viewers |
   | 1111 | the readers of the card, record or Drive file it comments on |
   | 7 | the readers of the card or comment it reacts to |
   | any event | also its own author |

2. **Stored queries:** filter results by reader. Filtering after the database breaks `limit`: a page could come back empty even though readable events lie further back, and the app's paging would stop early. So the query wrapper keeps reading further back until it has `limit` readable events or the database runs out, with a cap on how much it scans per request.
3. **Live events:** the same check in `PreventBroadcast`.
4. **Membership changes:** someone removed from a project stops getting its events from then on. What they already loaded stays in their browser, as with any shared document.
5. **App changes** ([src/hooks/use-projects.ts](src/hooks/use-projects.ts)):
   - "Every project on the team relays" now means every project the person can see. Two projects can share a slug only one person sees, so links can differ between people. Fix that by making project links fall back to the project id (`/p/<slug>` keeps working, and `/p/<id>` always does).
   - The people suggested in member pickers become those on projects and boards you share.
6. **Upstream:** this part is Freehub's own and stays in the fork.

### Later

Each needs its own decision; none is planned yet.

- **Upstream's management API (`#135`).** Rebase onto it once upstream releases it, after our own review of its 13,000 lines, since it adds an HTTP admin surface. Then extend it from one owner to a list of admins, and let Freehub manage the whitelist from the app instead of the file.
- **Asking for access from the app.** The "No access" screen could send a request that admins approve in the app, instead of copying an npub by hand. It needs a narrow exception for keys not yet whitelisted, with strict limits.
- **Faster first load with negentropy (NIP-77).** khatru supports it and applesauce can use it. It has to apply the same login and read rules as REQ before it's switched on.
- **khatru's successor.** Move from the archived `github.com/fiatjaf/khatru` to `fiatjaf.com/nostr/khatru` when upstream Haven does, rather than alone.
- **Another database.** Badger had a tag-query bug in 2025 (eventstore issue #46, Haven #80). If it bites again, move to LMDB or SQLite through Haven's JSONL export and import, rehearsed on a copy first.

## Relay contract

What the relay and Freehub agree on, written once and tested on both sides:

- **Scope of an event.**
  - A card or sprint belongs to the board in its `30301:` `a` tag.
  - A table, record, doc page, Drive folder or Drive file belongs to the project in its `30304:` `a` tag.
  - A comment belongs to the scope of the event its `A` tag points at.
  - A reaction belongs to the scope of the card its `a` tag points at or, without one, of the comment its last `e` tag points at.
- **Membership.**
  - A project's or board's members are its author plus its `p` tags.
  - A `p` tag with `viewer` in its fourth place makes a viewer, unless that person is also a member.
  - The latest event at the address wins. A kind 5 from the author for that address, at least as new, deletes it.
- **Connectors.** A table's latest version from any project member decides which connectors may write its records: its `p` tags.
- **Refusals** start with `restricted:`, `blocked:` or `auth-required:`, as NIP-01 and NIP-42 define them.

## Switching over

The data stays on the volume the whole time. Only the image changes.

1. **Before:**
   - check that the last hourly backup is less than an hour old;
   - take a Hetzner snapshot;
   - write down the current Dockerfile, environment and mounts.
2. In Coolify, change the relay app from the inline Dockerfile to the Docker image `ghcr.io/<org>/haven:v1.2.2-freehub.1`, with a registry login for the private image. Keep:
   - the volume on `/app/db`;
   - the `whitelisted_npubs.json` mount;
   - every environment variable;
   - port 3355 and the domain.
3. Deploy. Coolify pulls the image, then swaps the container: a few seconds without a relay. Open apps reconnect on their own, and unsent changes wait in each browser's outbox.
4. **After:**
   - from outside, check that a logged-out `limit: 0` REQ receives nothing and that COUNT is refused;
   - in the app, check that boards, tables and docs load and save;
   - check the connector logs.
5. **Rollback:** switch back to the saved inline Dockerfile, or an earlier image tag, and redeploy. The database format is unchanged, so either version reads it.

## Testing

- **Go tests in the fork** for every rule: the holes, limits, whitelist reload, and in phases 2–3 the contract cases.
- **End to end:** the fork's image in a container, a scratch database and a script with keys for a member, a viewer, an outsider, a connector and a logged-out client. The connector's harness from the connector work (a mini relay plus a fake Shopify) shows the pattern; here the real relay replaces the mini one.
- **Freehub against the fork:** the app's `public/config.json` can point at a local copy of the fork instead of `nak serve`, for development that matches production.

## Upstream

- **Disclosure first.** The holes are reported privately before our fix is public:
  - an encrypted email to `haven@bitvora.com`, the address on Haven's release key (`haven.asc`, fingerprint `1924 3581 B019 B245 2DA2 F828 70FF 8598 9022 1E23`);
  - a public issue without details, asking for a private channel and mentioning @barrydeen and @aaccioly.

  Our repository stays private until upstream ships a fix, or for 90 days at most.

- **Give back** each generic fix as a pull request from a public fork, once disclosure allows: the security fix, team mode, trusted proxies, limits per key, whitelist reload, the health check.
- **Take in** upstream releases by rebasing `freehub` on each new tag. That's quick while our generic fixes go upstream and Freehub's rules stay in their own files.

## Changes in the Freehub repo

- [README.md](README.md) → "Make it yours": recommend the fork and list what it adds, keeping plain Haven as the minimum (with the two fixes).
- `docs/relay-contract.md` and `relay-contract/cases.json`, with tests running the cases against `src/lib` (phase 2).
- Project links falling back to the project id (phase 3).
- [CONNECTOR_PLAN.md](CONNECTOR_PLAN.md): its blocker, the Haven patch, is phase 0 here.

## Order of work

1. Phase 0: private repository, security fix and tests, Dockerfile and image, rehearsal on a backup copy, switch over. Report upstream the same week. **Blocks real orders flowing through the connector.**
2. Phase 1: team mode, trusted proxies, limits per key, whitelist reload, health check, backup checks.
3. Phase 2: membership index, write rules, shared contract and test cases.
4. Phase 3: read rules, query wrapper, project links by id.
5. Later items, one decision at a time.

## Open questions

- Organization name and repository name for the fork.
- Who besides the owner manages the whitelist and the server, and whether phase 1 file reloading is enough until upstream's management API arrives.
- Whether viewers on the whitelist should see projects they aren't on before phase 3. Today they do.
- How long to wait for upstream before making our repository public, if they don't answer: the plan says 90 days.

## Risks

- **A rebase gets hard** if upstream changes the same code, for example when it moves to the new khatru. Keeping Freehub's rules in their own files limits the damage.
- **The read rules cost time per request,** since results are filtered after the database. At a team's size (thousands of events) that's small, but the scan cap needs a sensible default and a log line when it's hit.
- **The Go rules and the TypeScript model drift.** The shared test cases are the guard; a rule change in Freehub isn't done until the case file and the fork agree.
- **Pulling a private image adds a credential** to Coolify. It goes away once the repository is public.
