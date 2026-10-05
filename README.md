![Freehub banner](assets/banner.png)

<div align="center">
<h1>Freehub</h1>
<p>Nostr-first project management</p>
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

| Path                 | Holds                                    |
| -------------------- | ---------------------------------------- |
| `src/config.ts`      | Loading and checking `config.json`       |
| `src/lib/model.ts`   | Event kinds, parsing and templates       |
| `src/lib/relays.ts`  | Team relay connections, AUTH and access  |
| `src/lib/publish.ts` | Optimistic edits, signing and the outbox |
| `src/features/`      | Screens                                  |

## Make it yours

You need a private Nostr relay for the team. It must:

- require NIP-42 AUTH for reads and writes, and only let whitelisted pubkeys in;
- store kinds 30301–30303, 1111 and 5;
- be reachable over `wss://`.

The private relay in [Haven](https://github.com/bitvora/haven) does all of this. Events are signed but not encrypted, so whoever runs the relay can read every board: run it yourself or trust whoever does.

Then:

1. Fork this repo.
2. Set `relays` in `public/config.json` to your team relay.
3. Replace `public/logo.svg`, `public/logo-dark.svg` and `public/favicon.svg`.
4. Whitelist every member's npub on the relay. Anyone who isn't whitelisted gets a "No access" screen showing their npub, ready to copy and send to you.

### Configuration

All settings live in `public/config.json`:

| Field | Default | Notes |
| --- | --- | --- |
| `name` | `Kanban` | Shown in the browser tab and to signer apps when logging in. |
| `logo` | `/logo.svg` | Shown on the login screen and in the header. |
| `logoDark` | same as `logo` | Logo for dark mode. |
| `accent` | `#ffcb05` | Any CSS color. Buttons use dark or white text, whichever reads better on it. |
| `relays` | required | Team relays. Boards are read from and written to all of them; a change is saved once any one accepts it. |
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

- **Boards.** A board's creator picks its members. Members see the board and can edit any card or sprint. Only the creator can rename the board, change its members or delete it. Anything from non-members is ignored, even if it reaches the relay.
- **Saving.** Changes show up right away, then go to the signer and on to the relay. Once signed, a change is kept in the browser until a relay accepts it, so it survives reloads and time offline. A change still waiting on the signer is lost if the tab closes, and the app warns before that happens.
- **Where data goes.** Board data is only sent to the team relays, plus, encrypted, the relays a signer app talks through. Lookup relays only see which profiles are being fetched.

### Events

Boards and cards follow the draft kanban NIP used by [kanbanstr](https://github.com/vivganes/kanbanstr). Sprints are this app's own extension.

| Kind | Event | Tags |
| --- | --- | --- |
| 30301 | Board | `d`, `title`, `description`, `code`, `col`, `p` (members) |
| 30302 | Card | `d`, `a` (board), `title`, `description`, `s` (status), `rank`, `number`, `p` (assignee), `priority`, `due`, `sprint`, `label` |
| 30303 | Sprint | `d`, `a` (board), `title`, `number`, `status`, `start`, `end` |
| 1111 | Comment on a card ([NIP-22](https://github.com/nostr-protocol/nips/blob/master/22.md)) | `A`, `K`, `P`, `a`, `k`, `p` |
| 5 | Deleted board or comment ([NIP-09](https://github.com/nostr-protocol/nips/blob/master/09.md)) | `a` or `e`, `k` |

Each member publishes their own version of a card or sprint under the same `d` tag, and the newest version from any member wins. Deleting a card or sprint publishes a new version tagged `deleted`.

## Tech stack

- [Vite](https://vite.dev/) — build tool and dev server
- [React](https://react.dev/) — UI library, with the [React Compiler](https://react.dev/learn/react-compiler)
- [Tailwind CSS](https://tailwindcss.com/) — styling
- [shadcn/ui](https://ui.shadcn.com/) — component library, on [Base UI](https://base-ui.com/)
- [Motion](https://motion.dev/) — animations
- [dnd-kit](https://dndkit.com/) — drag and drop
- [applesauce](https://github.com/hzrd149/applesauce) — Nostr event store, relay connections and signers
- [RxJS](https://rxjs.dev/) — streams from the event store
- [wouter](https://github.com/molefrog/wouter) — routing
- [date-fns](https://date-fns.org/) — dates
- [Sonner](https://sonner.emilkowal.ski/) — toasts
- [Caddy](https://caddyserver.com/) — static file server in the production image

## Known limits

- Card numbers are picked as highest + 1 on each device, so two people adding cards at the same moment can get the same number.
- The columns are fixed: To do, In progress, Done.
- No file attachments yet.

## License

Released under the **MIT** license — see the [LICENSE](LICENSE) file for details.
