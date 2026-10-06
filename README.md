![Freehub banner](assets/banner.png)

<div align="center">
<h1>Freehub</h1>
<p>Nostr-first project management, CRM and docs</p>
</div>

## Screenshots

<details>
<summary>Show screenshots</summary>

<br />

![Sprint board](assets/screenshots/board.png)

![Card](assets/screenshots/card.png)

![Backlog](assets/screenshots/backlog.png)

![Dark mode](assets/screenshots/dark.png)

<img src="assets/screenshots/mobile.png" alt="Mobile" width="390" />

</details>

## Getting started

### Requirements

- [node v22+](https://nodejs.org/)
- [pnpm](https://pnpm.io/installation)
- [nak](https://github.com/fiatjaf/nak), for a local test relay

### Setup

1. Install the dependencies with `pnpm`:

```bash
pnpm install
```

2. Point the app at your relays in `public/config.json`. Out of the box it uses the local test relay below, so you can leave it until you deploy. See [Configuration](#configuration) for every field.

### Run

Start a local relay in one terminal and the app in another:

```bash
nak serve --auth    # in-memory relay on ws://localhost:10547 that requires AUTH
pnpm dev            # vite dev server
```

The application will be running on `http://localhost:5173`. Log in with a Nostr browser extension or a signer app. The test relay lets any key in and forgets everything when it stops.

### Build

```bash
pnpm typecheck    # type-check only
pnpm build        # type-check and build to dist/
pnpm preview      # serve the build on http://localhost:4173
```

### Lint and format

We use [ultracite](https://docs.ultracite.ai/) with [oxlint](https://oxc.rs/docs/guide/usage/linter) and [oxfmt](https://oxc.rs/docs/guide/usage/formatter) for the linting and formatting.

Run linter checks without modifying files:

```bash
pnpm check
```

Run the linter and auto-fix issues:

```bash
pnpm fix
```

### Project layout

| Path                       | Holds                                          |
| -------------------------- | ---------------------------------------------- |
| `src/config.ts`            | Loading and checking `config.json`             |
| `src/lib/model.ts`         | Event kinds, boards, cards and sprints         |
| `src/lib/project.ts`       | Projects                                       |
| `src/lib/crm.ts`           | CRM tables, fields, records and activity       |
| `src/lib/crm-templates.ts` | The table templates offered in "New table"     |
| `src/lib/docs.ts`          | Doc pages and how they nest                    |
| `src/lib/merge.ts`         | Merging two edits of the same page             |
| `src/lib/mentions.ts`      | Mentions in comments (NIP-27)                  |
| `src/lib/notifications.ts` | The rules that turn events into notifications  |
| `src/lib/inbox.ts`         | What each person read or archived in the inbox |
| `src/lib/relays.ts`        | Team relay connections, AUTH and access        |
| `src/lib/publish.ts`       | Optimistic edits, signing and the outbox       |
| `src/components/ui/`       | shadcn/ui components, including the sidebar    |
| `src/features/`            | Screens                                        |

## Make it yours

You need a private Nostr relay for the team. It must:

- require NIP-42 AUTH for reads and writes, and only let whitelisted pubkeys in;
- store kinds 30301–30307, 1111 and 5;
- keep its database on persistent storage, since the relay holds the only copy of the team's data;
- be reachable over `wss://`.

The private relay in [Haven](https://github.com/bitvora/haven) does all of this. Haven keeps its database in a `db` folder next to it (`/app/db` in its Docker image) and reads the whitelist only when it starts, so adding someone means a restart or redeploy: put `db` on a volume, or every redeploy starts with an empty relay. Events are signed but not encrypted, so whoever runs the relay can read every board and every CRM record, including the names, emails and phone numbers in it: run it yourself or trust whoever does.

Then:

1. Fork this repo.
2. Set `relays` in `public/config.json` to your team relay.
3. Replace `public/logo.svg`, `public/logo-dark.svg` and `public/favicon.svg`.
4. Whitelist every member's npub on the relay. Anyone who isn't whitelisted gets a "No access" screen showing their npub, ready to copy and send to you. The app can't read the whitelist, so the first time someone joins a project or board, paste their npub (or the whole whitelist file) into its members field; after that they're suggested by name everywhere.

### Configuration

All settings live in `public/config.json`:

| Field | Default | Notes |
| --- | --- | --- |
| `name` | `Kanban` | Shown in the browser tab and to signer apps when logging in. |
| `logo` | `/logo.svg` | Shown on the login screen and in the header. |
| `logoDark` | same as `logo` | Logo for dark mode. |
| `accent` | `#ffcb05` | Any CSS color. Buttons use dark or white text, whichever reads better on it. |
| `relays` | required | Team relays. Boards are read from and written to all of them; a change counts as saved once one accepts it, and the others get it in the background. |
| `signerRelays` | nos.lol, relay.primal.net, relay.damus.io | Relays the app and a signer app talk through when logging in by QR code. |
| `lookupRelays` | purplepag.es, user.kindpag.es, relay.damus.io | Public relays used to look up members' names and avatars. |

Relay URLs must start with `wss://`. `ws://` is accepted only for localhost.

## Deploy

Whichever way you deploy, set `relays` in `public/config.json` to your team relay first. The default only works on your own machine.

### Coolify

1. Under **Sources**, add a **GitHub App** and give it access to your repository, so every push deploys on its own.
2. Create a new resource from the repository and choose the **Dockerfile** build pack. Not Docker Compose: `compose.yaml` binds ports 80 and 443, which Coolify's proxy already uses.
3. Set **Ports Exposes** to `80`, and **Domains** to your URL with `https://`, for example `https://kanban.example.com`. Coolify's proxy gets the certificate.
4. Deploy.

Leave `DOMAIN` unset. Coolify's proxy handles TLS, so Caddy only needs to serve plain HTTP on port 80.

To change the config or logos without a rebuild, add a file mount under **Persistent Storage** at `/branding/config.json` (or `/branding/logo.svg`, and so on) and restart. Files in `/branding` win over the built copies.

### Docker Compose

On a VPS with Docker, point a DNS record at the server, open ports 80 and 443, and run:

```bash
echo "DOMAIN=kanban.example.com" > .env
docker compose up -d --build
```

Caddy serves the app and gets a TLS certificate on its own. `public/` is mounted into the container, so changes to `config.json` or the logos show up on the next page load, without a rebuild. To update, pull and run `docker compose up -d --build` again.

Behind an existing reverse proxy, leave `DOMAIN` unset so Caddy serves plain HTTP on port 80, and change the port mapping in `compose.yaml`.

### Static host

Run `pnpm build` and serve `dist/` from the root of a domain. Send unknown paths to `index.html`, and don't let browsers cache `index.html` or `config.json`. Files under `/assets/` are safe to cache forever.

## How it works

There is no backend and no database. The app is a static site: every change is a signed Nostr event sent to your relay, and the relay's whitelist decides who gets in. People log in with a Nostr browser extension (NIP-07) or a signer app (NIP-46, by QR code or `bunker://` link), so the app never sees anyone's private key.

- **Projects.** A project groups boards, CRM tables and docs, and the sidebar lists them under it. Its creator picks the members, renames it and can delete it. An organization can run as many projects as it likes, for example one per city or per product.
- **Boards.** A board's creator picks its members. Members see the board and can edit any card or sprint. Only the creator can rename the board, change its members or delete it. A board can sit in a project or on its own. Anything from non-members is ignored, even if it reaches the relay.
- **Cards.** A card can have several assignees. Its description is rich text saved as Markdown: Markdown typed into it formats as you go (`### ` makes a heading, `[] ` or `- [ ] ` a checklist), pasted Markdown and web content keep their formatting, and text copied out across several blocks reads as Markdown. Raw HTML in a description stays plain text, and links only go to web and mail addresses.
- **Inbox.** Typing `@` in a comment suggests the board's members. A mention is saved as a `nostr:npub…` reference in the comment with a `p` tag for that person (NIP-27), so the relay routes it and other Nostr clients show it too. Mentions land in the person's inbox; opening the card marks them read. Notifications are read from the comments themselves through the rules in `src/lib/notifications.ts`, so another way of delivering them, such as an email bridge subscribed to the relay, can reuse the same rules.
- **CRM.** Each project can hold several tables, such as merchants, companies, people or deals. Every table has its own fields (text, numbers, money, dates, selects, members, links to other tables and more) and can have a stage field that turns it into a pipeline with won and lost endings. Any project member can add tables, change their fields and edit records. Records show up as a table (sorting, search, filters, column picker, bulk changes, CSV import and export), as a pipeline board and as insights. Every stage change is kept on the record, so its journey and the time spent in each stage can be read back. Notes, calls, emails, meetings and visits are logged on a record as comments.
- **Docs.** Each project has docs: pages that can hold pages of their own, shown as a tree under the project in the sidebar. Any project member can write, move or delete any page. Pages are edited in place, as in Notion. Typing `/` opens a menu of blocks. Hovering a block shows `+`, which adds a block below it, and a handle that drags it somewhere else or opens its menu. List items move on their own, and `Mod+Shift+↑`/`↓` moves the block the cursor is in. Pages in the sidebar can be dragged before, after or into each other. The text is saved as Markdown a second after typing pauses.
- **Editing a page together.** When two people edit a page at once, each one's saved edits show up in the other's page as they arrive, without moving their cursor. The two versions are merged line by line, so edits to different lines, even neighbouring list items, are all kept. When both change the same line, the person still typing keeps theirs; between two saved versions, every device picks the same one.
- **Saving.** Changes show up right away, then go to the signer and on to the relay. Once signed, a change is kept in the browser until every team relay has it, so it survives reloads and time offline. A change still waiting on the signer is lost if the tab closes, and the app warns before that happens.
- **Loading.** Relays only send their newest few hundred events per request, so the app pages back through everything they hold before a board or table counts as loaded, then keeps listening. When a relay drops or closes the connection, it reconnects and catches up on what it missed.
- **Where data goes.** Board data is only sent to the team relays, plus, encrypted, the relays a signer app talks through. Lookup relays only see which profiles are being fetched.

### Events

Boards and cards follow the draft kanban NIP used by [kanbanstr](https://github.com/vivganes/kanbanstr). Sprints, projects, the CRM and docs are this app's own extensions.

| Kind | Event | Tags |
| --- | --- | --- |
| 30301 | Board | `d`, `title`, `description`, `code`, `col`, `p` (members), `a` (project, optional) |
| 30302 | Card | `d`, `a` (board), `title`, `description`, `s` (status), `rank`, `number`, `p` (assignees), `priority`, `due`, `sprint`, `label` |
| 30303 | Sprint | `d`, `a` (board), `title`, `number`, `status`, `start`, `end` |
| 30304 | Project | `d`, `title`, `description`, `slug`, `color`, `p` (members) |
| 30305 | CRM table | `d`, `a` (project), `title`, `singular`, `slug`, `icon`, `description`, `creator`, `created`, `field` (id, type, name, config), `option` (field, id, label, color, stage outcome) |
| 30306 | CRM record | `d`, `a` (table), `a` (project), `title`, `rank`, `created`, `creator`, `val` (field, value), `moved` (stage, time, member) |
| 30307 | Doc page | `d`, `a` (project), `title`, `icon`, `parent`, `rank`, `created`, `creator`, `prev` (the version it was edited from) |
| 1111 | Comment on a card, or activity on a record ([NIP-22](https://github.com/nostr-protocol/nips/blob/master/22.md)) | `A`, `K`, `P`, `a`, `k`, `p` (plus one per person mentioned), `activity` (records only) |
| 5 | Deleted board, project or comment ([NIP-09](https://github.com/nostr-protocol/nips/blob/master/09.md)) | `a` or `e`, `k` |

`d` tags are 16 random hex characters, so every address (`kind:pubkey:d`) stays under the 100 characters that relays built on [eventstore](https://github.com/fiatjaf/eventstore), Haven among them, index for `#a` queries. Boards and projects made before that used longer `d` tags, so their cards, sprints, tables, records and comments are fetched by author instead and matched by address in the browser.

Each member publishes their own version of a card, sprint, CRM table, record or doc page under the same `d` tag, and the newest version from any member wins. Deleting one publishes a new version tagged `deleted`. A record keeps one `val` tag per value, so a multi-select holds several, and field values are stored as plain text: numbers as decimals, dates as `YYYY-MM-DD`, members as hex pubkeys and links to other records by their `d` tag.

A doc page's text is the event's content, as Markdown. Its `parent` is the `d` tag of the page it sits under, and pages at the top have none. `prev` is the id of the version the editor started from, so a teammate's editor knows what each side changed when it merges two versions saved at once. Deleting a page deletes the pages under it too.

## Tech stack

- [Vite](https://vite.dev/) — build tool and dev server
- [React](https://react.dev/) — UI library, with the [React Compiler](https://react.dev/learn/react-compiler)
- [Tailwind CSS](https://tailwindcss.com/) — styling
- [shadcn/ui](https://ui.shadcn.com/) — component library, on [Base UI](https://base-ui.com/)
- [TanStack Table](https://tanstack.com/table) — the CRM's sorting, filtering, selection and paging
- [Motion](https://motion.dev/) — animations
- [dnd-kit](https://dndkit.com/) — drag and drop
- [Tiptap](https://tiptap.dev/) — the card description and doc page editor, on [ProseMirror](https://prosemirror.net/), with [marked](https://marked.js.org/) reading its Markdown
- [node-diff3](https://github.com/bhousel/node-diff3) — line diffs for merging edits of the same page
- [applesauce](https://github.com/hzrd149/applesauce) — Nostr event store, relay connections and signers
- [RxJS](https://rxjs.dev/) — streams from the event store
- [wouter](https://github.com/molefrog/wouter) — routing
- [date-fns](https://date-fns.org/) — dates
- [Sonner](https://sonner.emilkowal.ski/) — toasts
- [Caddy](https://caddyserver.com/) — static file server in the production image

## Known limits

- Card numbers are picked as highest + 1 on each device, so two people adding cards at the same moment can get the same number.
- Board codes and project links are checked against every board and project on the relay, but two made at the same moment can still match. Links then name the board with `?board=`, and one of the projects gets a `-2` link.
- Removing someone from a board or project hides the cards, sprints, CRM tables, records and doc pages whose newest version is theirs: each falls back to an older version or disappears, a table with its records. Comments on their versions are hidden too. Adding them back shows it all again.
- The columns are fixed: To do, In progress, Done.
- No file attachments yet.
- A linked image in a description, such as a `[![badge](…)](…)` badge, loses its link once the description is edited.
- A CRM record is saved as a whole, so two people changing different fields of the same record at the same moment can undo one another's change.
- Importing a CSV signs one event per row; a signer app may ask to approve each one. At most 500 rows go in per import.
- A record remembers its last 100 stage changes.
- A doc page is saved whole, as one event, so a long page costs a little more with each save. Edits merge line by line: a paragraph is one line, so two people rewriting the same paragraph at once keep only one version of it.
- A deleted page can't be brought back. Deleting a page while someone else has it open drops whatever they hadn't saved yet.
- Pages have no links to other pages yet, other than the ones under them; a link to a page's address works as any web link.
- The inbox keeps what you read or archived in the browser, so another device starts with every mention unread. It shows the newest 200 mentions, and only mentions in card comments for now.
- `INBOX` can't be a board code, since the inbox lives at `/inbox`. Likewise a table named "Docs" gets the link `docs-2`, since a project's docs live at `/p/<project>/docs`.

## License

Released under the **MIT** license — see the [LICENSE](LICENSE) file for details.
