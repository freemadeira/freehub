# Freehub guide

How to run Freehub for your team, and how it works inside. To try it on your own machine first, see [Getting started](README.md#getting-started).

## Make it yours

You need a private Nostr relay for the team. It must:

- require NIP-42 AUTH for reads and writes, and only let whitelisted pubkeys in;
- store kinds 0, 30078, 30301–30310, 30320–30322, 1111, 7 and 5;
- keep its database on persistent storage, since the relay holds the only copy of the team's data;
- be reachable over `wss://`.

The private relay in [Haven](https://github.com/bitvora/haven) does all of this. Haven keeps its database in a `db` folder next to it (`/app/db` in its Docker image) and reads the whitelist only when it starts, so adding someone means a restart or redeploy: put `db` on a volume, or every redeploy starts with an empty relay. Events are signed but not encrypted, so whoever runs the relay can read every board and every CRM record, including the names, emails and phone numbers in it: run it yourself or trust whoever does. The whitelist is all the relay knows: anyone on it can read every board and project there with any Nostr client. Whether someone can edit or only view is kept by the app, which ignores changes from viewers.

Then:

1. Fork this repo.
2. Set `relays` in `public/config.json` to your team relay.
3. Replace `public/logo.svg` and `public/logo-dark.svg`, the browser tab's `public/favicon.png`, and the installed app's name and icons in `public/manifest.webmanifest`, `public/icons/` and `public/apple-touch-icon.png`. Freehub's own are made from `assets/icon.png`; `icons/badge.png` is the icon's shape in white, which Android shows in the status bar.
4. Optionally, give the team a map of your region: see [Map](#map).
5. Optionally, give each project a Drive for its files: see [Drive](#drive).
6. Optionally, push notifications to people's phones and computers: see [Notifications](#notifications).
7. Optionally, have the links people save to catalogs read, titled and filed for them: see [Reader](#reader).
8. Optionally, keep [BTC Map](https://btcmap.org/) in line with a merchants table: see [BTC Map sync](#btc-map-sync).
9. Whitelist the npub of everyone who uses the app, viewers too, on the relay. Anyone who isn't whitelisted gets a "No access" screen showing their npub, ready to copy and send to you. The app can't read the whitelist, so the first time someone joins a project or board, paste their npub (or the whole whitelist file) into its members field; after that they're suggested by name everywhere.

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
| `lookupRelays` | purplepag.es, profiles.nostr1.com, directory.yabu.me | Public relays used to look up members' names and avatars. |
| `map` | none | `{ "world": "/worlds/<name>/world.json" }`, the address of a world pack. Without it there's no Map tab, and the map's code is never downloaded. See [Map](#map). |
| `connectors` | none | npubs of the connectors your organization runs, and of its [BTC Map sync](#btc-map-sync). Their sources show up in each table's settings, under **Connections**. See [Connectors](#connectors). |
| `blossom` | none | Blossom servers for the team's files, as `https://` URLs. Uploads go to the first; files are read from whichever has them. Without it there's no Drive. See [Drive](#drive). |
| `notifier` | none | `{ "pubkey": "npub…", "vapidKey": "B…" }`, the notifier's npub and VAPID public key. Without it, notifications only show while the app is open. See [Notifications](#notifications). |
| `reader` | none | `{ "pubkey": "npub…" }`, the reader's npub. Only its readings of links count. Without it, saved links show by their address until someone titles them. See [Reader](#reader). |

Relay URLs must start with `wss://`. `ws://` is accepted only for localhost.

### Map

The Map tab shows your region in 3D, in soft pastels, with every CRM record that has a Location field as a pin on it. It's off unless `config.json` has a `map` entry pointing at a world pack: the region's ground heights, land cover and OpenStreetMap features, baked once and served as static files.

The map is alive, all from the same data. Cars, vans and buses drive the road network: they follow one another, slow for bends, take turns at junctions and give way to bigger roads, signal their turns, and disappear only into tunnels or out of sight. People walk the paths, squares and sidewalks, some stopping now and then to look around, and stand chatting on squares, in parks and outside shops. Boats rock at their moorings. Cable cars run on two ropes over their pylons, high enough to clear the buildings under them, and planes and ferries come and go where the region has an airport or a ferry route, with planes parked at the stands OpenStreetMap maps. Buildings take the colors, roof shapes and heights OpenStreetMap gives them, softened to the map's pastels. Everything stands still for people whose system asks for reduced motion. Packs baked before planes, ferries, stands and pylon heights were added still load; bake again to get them.

The map can also be heard. A speaker button beside the credits plays what's in view, mixed from the same data: the sea and the surf along the coast, wind on the heights, birds over forest and fields or crickets at night, a town's bustle, gulls in harbors, and the planes, ferries, cable cars and traffic nearby, each from its side. It fades as the view moves or zooms out, and it's off on every visit until someone turns it on. The recordings ship with the app, about 3 MB fetched only then; they're public domain (CC0), listed in `src/features/map/engine/sound/sounds/CREDITS.md`, and they suit any region.

Bake one with `tools/world`, which needs [node v22.18+](https://nodejs.org/) and an internet connection the first time:

```bash
cd tools/world
pnpm install
pnpm bake --config path/to/world.config.json --out ../../public/worlds/<name>
```

The config names the region and where the camera starts:

```json
{
  "name": "Madeira",
  "bounds": [-17.28, 32.62, -16.64, 32.88],
  "view": {
    "lat": 32.6505,
    "lng": -16.9095,
    "distance": 2600,
    "pitch": 42,
    "heading": 0
  },
  "landmarks": []
}
```

`bounds` is west, south, east, north in degrees; keep it to an island or a city, since everything inside is baked at street detail. `view` sets where the map opens: `distance` in meters from the camera to that point, `pitch` in degrees above the horizon and `heading` in degrees from north. Each landmark is a model you made (glTF binary, meters, y up) that replaces the map's own buildings within `clear` meters of its spot, with an optional round `badge` picture beside its name:

```json
{
  "id": "se",
  "name": "Sé do Funchal",
  "lat": 32.64822,
  "lng": -16.90823,
  "model": "landmarks/se.glb",
  "badge": "badges/se.png",
  "heading": 0,
  "clear": 30
}
```

The bake downloads OpenStreetMap data through [Overpass](https://overpass-api.de/), the [Copernicus GLO-30](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM) elevation model and [ESA WorldCover](https://esa-worldcover.org/) land cover, keeps them in a `.cache` folder next to the config, and writes the pack in about ten seconds. Run it again with `--refresh` to pick up newer OpenStreetMap data. `public/worlds/` is ignored by git; a pack is data, not code.

To serve a pack, put it where the app can reach it: under `public/worlds/` when running locally, or mounted at `/branding/worlds/<name>` in the container, like `config.json`. Any other web address works too if it allows cross-origin requests.

The map comes from your own server: no tiles or fonts are fetched from anyone else. OpenStreetMap data is under the [ODbL](https://www.openstreetmap.org/copyright), so the map credits its contributors, and a world pack you publish is shared under the same license.

### Drive

Each project gets a Drive for its files once `config.json` lists a [Blossom](https://github.com/hzrd149/blossom) server under `blossom`. Files are encrypted in the browser before they leave it (AES-GCM, a new key per file), and the key travels in the file's event on your private relay, so the Blossom server only ever holds what it can't read. Files are opened in the browser to preview them as well, whole and in memory, which is why each can be up to 100 MB.

The server must:

- take uploads only from the team, through BUD-11 authorization (`PUT /upload`), and let each uploader delete their own blobs (`DELETE /<sha256>`);
- accept `application/octet-stream`, since every blob is encrypted, up to a little over 100 MB;
- keep blobs for good: no expiry rules;
- answer cross-origin requests from the app, with the `Authorization` and `X-SHA-256` headers allowed.

[blossom-server](https://github.com/hzrd149/blossom-server) does all of this. Its example config deletes blobs nobody opened for a week, so replace its `storage.rules` with one rule that lists the team and lasts for as long as you need, and keep `upload.requirePubkeyInRule` on:

```yaml
storage:
  rules:
    - type: "*"
      expiration: 100 years
      pubkeys:
        - <hex pubkey of each teammate>
upload:
  requireAuth: true
  requirePubkeyInRule: true
  maxSize: 110000000
list:
  enabled: false
```

To try it locally, run any Blossom server on your machine and add `"blossom": ["http://localhost:3000"]` (or its port) to `public/config.json`; `http://` is accepted only for localhost.

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

### Connectors

A connector runs next to the app as its own container, built from this repository with `connector/Dockerfile`. It gets webhooks from its sources, fetches what tables map from the source's API, and publishes records to the team relay; every hour it also catches up on what changed in the last 26 hours, in case a webhook went missing. Shopify is the only kind of source so far: new kinds go in `connector/sources/`.

1. Make a Nostr key for the connector and whitelist its npub on the team relay.
2. Write the sources, as in `connector/sources.example.json`, to a file or to the `SOURCES` variable. Settings written as `${NAME}` are read from the environment, so secrets stay out of them.
3. Run the image with these environment variables, and the sources file at `/app/sources.json`:

   | Variable | Notes |
   | --- | --- |
   | `CONNECTOR_KEY` | The connector's nsec or hex key. |
   | `RELAY_URL` | The team relay. |
   | `PUBLIC_URL` | Where the connector is reachable, such as `https://connect.example.com`. Webhooks go to `<PUBLIC_URL>/sources/<source id>`. |
   | `CONNECTOR_NAME` | The name records show as written by. Defaults to the source's name when there's one source. |
   | `SOURCES` | The sources as JSON, instead of a file. |
   | `SOURCES_FILE` | Defaults to `/app/sources.json`. Used when `SOURCES` isn't set. |
   | `PORT` | Defaults to `3000`. `GET /` answers `ok`, for health checks. |

4. Add its npub to `connectors` in `config.json`, then switch its source on in a table's settings.

To bring in older items, run `node connector.js backfill <source id> <YYYY-MM-DD>` inside the container. It writes about 40 records a minute, to stay under the relay's limits.

For Shopify, create the app from the store's admin (Settings → Apps → Develop apps → Build apps in Dev Dashboard) with the scopes `read_orders` and `read_customers` (and `read_all_orders` for orders older than 60 days), install it on the store, and put its client ID and secret in the sources with the store's `<handle>.myshopify.com` domain. The connector gets its own access token and sets up the order webhooks itself. An app made in the store's own organization gets protected customer data without asking, but customers' names and emails only on the Grow plan or higher: on other plans the connector leaves Customer and Email out of what tables can map. A legacy custom app's static token works too, as `accessToken`.

### BTC Map sync

[BTC Map](https://btcmap.org/) shows the merchants OpenStreetMap tags as taking bitcoin. The sync keeps those tags in line with a CRM table, such as one made from the **Merchant adoption** template: every night it compares each merchant's record with its OpenStreetMap element, and on the first Monday of each month it lists the merchants OpenStreetMap has in your area that no record links to, as leads. For now it's a dry run: it prints what it would do, and writes nothing to OpenStreetMap or to the records.

It runs next to the app as its own container, built from this repository with `btcmap/Dockerfile`, and shows up in tables as a source, like a connector's:

1. Make a Nostr key for it, with `node btcmap.js key` inside the image, and whitelist its npub on the team relay.
2. Run the image with these environment variables:

   | Variable | Notes |
   | --- | --- |
   | `BTCMAP_KEY` | The sync's nsec or hex key. |
   | `RELAY_URL` | The team relay. |
   | `BTCMAP_AREA` | Where discovery looks: south, west, north and east in degrees, such as `32.55,-17.35,33.15,-16.25`. Without it, there's no discovery. |
   | `ADDRESS_FORMAT` | How records write addresses, so they can go to OpenStreetMap: `pt` reads `Rua da Carreira 12, 9000-042 Funchal`. Without it, no address goes. Other countries' formats go in `btcmap/addresses.ts`. |
   | `TZ` | The time zone of the nightly run from 23:00 and of discovery from 9:00, such as `Atlantic/Madeira`. Defaults to UTC. A run that fails is tried again every 15 minutes that day. |
   | `OSM_CONTACT` | An email or web address where OpenStreetMap can reach whoever runs the sync, sent with every request. |
   | `OSM_API`, `OVERPASS_URL` | Default to OpenStreetMap's own API and to overpass-api.de. |

3. Add its npub to `connectors` in `config.json`. Once it has started, **OpenStreetMap** shows under **Connections** in each table's settings. Switch it on, then pick the fields that hold the OSM link, the stage, the location, a relocated business's new location, the address, the website and the "On BTC Map" checkbox, and which of the stage's options mean Accepting bitcoin, Not interested, Closed and Relocated. Options left out, or picked for two meanings, change nothing.

| Stage | On OpenStreetMap |
| --- | --- |
| Accepting bitcoin | Adds `currency:XBT=yes`, and `check_date:currency:XBT` from the newest visit logged since the record took the stage. Fills in the website and the address when OpenStreetMap has none. |
| Not interested | Takes off `currency:XBT`, `payment:bitcoin`, `payment:lightning`, `payment:onchain` and `payment:lightning_contactless` where they say yes, with the check date. One that says no stays. |
| Closed | Deletes the node. |
| Relocated | Once the new location is pinned, moves the node there with the new address, if the node is still at the record's location. |

Before changing anything, the sync checks that the element is still the record's business: its OpenStreetMap name, alone or with its branch, must be the record's title. It never changes a business's name, never replaces a website or address OpenStreetMap already has (other than a relocated business's address), and never clears a tag because a field is empty. What it can't do safely it lists for a mapper to do by hand: a business whose name doesn't match, one drawn as an area or on a node a way uses, a relocated node that isn't where the record had it, or a move whose new address it can't read. A record whose OSM link it can't read, or that links to the same element as another record in any table, is skipped and listed. It reads OpenStreetMap one request a second, as its usage policy asks, and the only thing it writes to the team relay is its source.

Run `node btcmap.js nightly` or `node btcmap.js discover` inside the container to run one now. On Coolify, create it from the repository with the **Dockerfile** build pack and `btcmap/Dockerfile`, with no domain.

### Notifications

The app installs from the browser as a PWA: from Chrome or Edge's install button or the account menu, and on iPhone and iPad from Share → Add to Home Screen. It opens even without a connection, though boards and tables need the relay to show, and an open app reloads into a new deploy by itself while it's out of view.

Each person turns notifications on per device, with the bell at the top of the inbox. Without a notifier, they show while the app is open in the background. With one, they're pushed even when it's closed; iPhone and iPad only take pushes in the app added to the Home Screen.

The notifier runs next to the app as its own container, built from this repository with `notifier/Dockerfile`. It reads the team relay and works out each person's notifications with the same rules as the inbox. It waits a little, skips what was read meanwhile, and pushes the rest, with Web Push, to the devices people turned notifications on for. It never writes to the relay.

1. Make a Nostr key for the notifier, with `node notifier.js key` inside the image, and whitelist its npub on the team relay.
2. Make its VAPID keys once, with `node notifier.js vapid` inside the image, and keep both. Devices subscribe to the public key, so changing it means everyone turns notifications on again.
3. Run the image with these environment variables, and a volume at `/app/data`:

   | Variable | Notes |
   | --- | --- |
   | `NOTIFIER_KEY` | The notifier's nsec or hex key. |
   | `RELAY_URL` | The team relay. |
   | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | From step 2. |
   | `VAPID_SUBJECT` | A `mailto:` or `https://` address where push services can reach you. |
   | `DELAY` | Seconds news waits before it's pushed. Defaults to `30`. |
   | `TZ` | The time zone due reminders go out in, such as `Atlantic/Madeira`. Defaults to UTC. |
   | `LOOKUP_RELAYS` | Relays to read people's names from, comma-separated. Defaults to the app's. |
   | `STATE_FILE` | Defaults to `/app/data/state.json`: what was pushed, so a restart repeats nothing. |
   | `PORT` | Defaults to `3000`. Any request answers `ok`, for health checks. |

4. Add it to `config.json`: `"notifier": { "pubkey": "<its npub>", "vapidKey": "<VAPID_PUBLIC_KEY>" }`.

On Coolify, create it from the repository with the **Dockerfile** build pack and `notifier/Dockerfile`, with no domain, and the volume under **Persistent Storage**. On its first start, news already on the relay counts as told, so nothing old is pushed.

The notifier reads every board, project and comment on the relay, and people's inbox marks and devices are encrypted to its key: keep the key as safe as the relay.

### Reader

The reader runs next to the app as its own container, built from this repository with `reader/Dockerfile`. It watches the team relay for links saved to catalogs and reads each page the way link previews do: its title, description, picture, author and date, through the platform's own API for YouTube, X, TikTok, Vimeo, Spotify, SoundCloud and Reddit. With an [OpenRouter](https://openrouter.ai/) key, a model then gives the link a short title and summary, says what kind of link it is, files it under up to three of the catalog's categories and suggests new ones; it also sorts a catalog's links into a category when someone asks. The picture is encrypted and copied to the team's Blossom server, so cards keep it after the page changes and no one's browser loads it from the site. Everything it learns goes to the relay as a reading of its own, under what people change by hand.

1. Make a Nostr key for the reader, with `node reader.js key` inside the image, and whitelist its npub on the team relay. With a Blossom server, add its hex pubkey to the server's storage rule too, as for a teammate.
2. Run the image with these environment variables:

   | Variable | Notes |
   | --- | --- |
   | `READER_KEY` | The reader's nsec or hex key. |
   | `RELAY_URL` | The team relay. |
   | `BLOSSOM_URL` | The Blossom server pictures go to, usually the first under `blossom` in `config.json`. Without it, cards load pictures from the sites they're on. |
   | `OPENROUTER_API_KEY` | Without it, links get only what their pages say about themselves: no summaries, no filing and no sorting. |
   | `OPENROUTER_MODEL` | Defaults to `google/gemini-3.1-flash-lite`. Any model OpenRouter serves with structured outputs works. |
   | `AI_RUNS_PER_HOUR` | Model runs the links one person saves and sorts may take in an hour. Defaults to `200`. Past it, their links are read without the model, and sorting asks them to try again later. |
   | `APP_NAME` | The name OpenRouter lists the runs under. Defaults to `Freehub`. |
   | `PORT` | Defaults to `3000`. Any request answers `ok`, for health checks. |

3. Add it to `config.json`: `"reader": { "pubkey": "<its npub>" }`. With a notifier, set the notifier's `READER_PUBKEY` to the same npub, so pushes name links by the titles the reader gave them.

On Coolify, create it from the repository with the **Dockerfile** build pack and `reader/Dockerfile`, with no domain. It keeps nothing of its own: on each start it reads what's on the relay and picks up the links still waiting.

The reader fetches whatever address a member saves, so it refuses local and private network addresses, checked again on each redirect, and reads at most 2 MB of a page or a picture. What it tells the model leaves for OpenRouter and the model's provider: the link, the note saved with it, what the page says, and the catalog's name, description and categories.

### Static host

Run `pnpm build` and serve `dist/` from the root of a domain. Send unknown paths to `index.html`, and don't let browsers cache `index.html`, `config.json`, `sw.js` or `version.json`. Serve `manifest.webmanifest` as `application/manifest+json`. Files under `/assets/` are safe to cache forever.

## How it works

There is no backend and no database. The app is a static site: every change is a signed Nostr event sent to your relay, and the relay's whitelist decides who gets in. People log in with a Nostr browser extension (NIP-07) or a signer app (NIP-46, by QR code or `bunker://` link), so the app never sees anyone's private key.

- **Projects.** A project groups boards, CRM tables and docs, and the sidebar lists them under it. Its creator picks its people, renames it and can delete it. Each person either can edit or can only view: viewers see the project's tables and docs but can't change them, add to them or comment. An organization can run as many projects as it likes, for example one per city or per product.
- **Boards.** A board's creator picks its people the same way. Members can edit any card or sprint; viewers can read the board, its cards and their comments. Only the creator can rename the board, change who's on it or delete it. A board can sit in a project or on its own, and only the project's members can put boards in it. A new board in a project starts with the project's people and roles. Anything from viewers or anyone else not a member is ignored, even if it reaches the relay.
- **Cards.** A card can have several assignees. Its description is rich text saved as Markdown: Markdown typed into it formats as you go (`### ` makes a heading, `[] ` or `- [ ] ` a checklist), pasted Markdown and web content keep their formatting, and text copied out across several blocks reads as Markdown. Raw HTML in a description stays plain text, and links only go to web and mail addresses. A link to a card, board, doc page, project, table, record, catalog, saved link or Drive file of the app, pasted or typed into a description, a doc page or a comment, shows as what it goes to, by its icon and title, and opens in place; it's saved as the address in angle brackets (`<https://…>`), so other Markdown readers still link it. A card can be marked as blocked by another card, blocking one, or related to one, from its ⋯ menu, the command palette or `M` then `B`, `X` or `R`: any card on its board, or on another board of the same project you're a member of. Two cards stand one way only, so marking them again another way replaces it, and blocking already counts as related. The card's page lists them under its properties, and while a card still open holds it up, its status icon carries a red badge; on the board, a card shows what it's blocked by and what it's blocking, among cards still open. The card keeps its history: who made it, and every change to its status, assignees, priority, due date and title, and to the cards it's marked against, between its comments; marking two cards tells both. Changes someone makes one after another are told as one. Members react to a card, or to a comment on it, with any emoji; clicking a reaction adds yours or takes it back, and hovering it shows who reacted.
- **All boards.** Boards, in the sidebar, puts the active sprint of every board you're on into one board, viewers' boards too: a column per status the boards use, or a list grouped by status, each card with its board's code. Cards filter by project, board and assignee; the assignees offered are the people with a card there. Dragging a card to another column changes its status, but only to one its board uses: over any other column it shows back where it started. Moving it up or down orders it among its own board's cards. Adding a card asks which board it goes on, from those you're a member of, and puts it in that board's active sprint; the board picked last is offered first. Opening a card goes to it on its board, and going back returns to Boards. The filters and the layout are kept in the browser.
- **Home.** Home shows what's on your plate: open cards assigned to you or made by you, on every board you're on, as a list by due date (overdue, today, tomorrow, this week, later, no date) or on a month calendar. They filter by project, board, status and priority, and down to those assigned to you or those you made. Status, priority and due date change right from the list. On the calendar, dragging a card to another day moves its due date, and cards without one wait in a tray beside it, to be dragged onto a day. Done cards leave Home. Projects, boards, CRM tables, catalogs and doc pages can be pinned to Home with the pin in their top bar, from the sidebar's right-click menu, or with Pin on Home itself. Home also shows the newest mentions from the inbox, the links saved lately to every catalog, and the projects; the button in its top bar reorders or hides each section. Weeks start on the day they do where the browser is set. What's pinned, the sections, the filters and the view are kept on the relay, encrypted, so every device shows the same Home; each pin and each setting keeps when it changed, so changes made on two devices at once all stay.
- **Inbox.** Typing `@` in a comment, a card's description, a doc page, a note on a record or a comment on a file or a saved link suggests the people who can read it, viewers included. A mention is saved as a `nostr:npub…` reference in the text with a `p` tag for that person (NIP-27), so the relay routes it and other Nostr clients show it too. The inbox also tells people when they're assigned a card or put in a record's member field, when a card they're assigned is due the next day, and what happens on cards they subscribe to: comments, changes to status, assignees, priority and due date, and the cards they're marked against. Making a card, being assigned it or commenting on it subscribes someone; the bell on the card's page subscribes or unsubscribes, and a row in the inbox can unsubscribe too. Whoever saved a link hears of comments on it. News about one card, page, file, link or record shows as one row. Opening it marks it read, and a page opened from the inbox scrolls to the mention. What each person read or archived is kept on the relay, encrypted, so all their devices agree. A page is saved again and again as people type, so it also keeps who mentioned each person and when: they hear about it once, and again only when someone picks them from the list anew. Taking the mention out of the page or description takes it out of their inbox. Notifications are read from the events themselves through the rules in `src/lib/notifications.ts`, which the [notifier](#notifications) shares.
- **CRM.** Each project can hold several tables, such as merchants, companies, people or deals. Every table has its own fields (text, numbers, money, dates, selects, members, links to other tables and more) and can have a stage field that turns it into a pipeline with won and lost endings. Any project member can add tables, change their fields and edit records. Records show up as a table (sorting, search, filters, column picker, bulk changes, CSV import and export), as a pipeline board and as insights. Every stage change is kept on the record, so its journey and the time spent in each stage can be read back. Notes, calls, emails, meetings and visits are logged on a record as comments.
- **Connectors.** A connector is an optional service with its own Nostr key that feeds a source, such as an online store, into CRM tables: each order becomes a record. It describes each source in a manifest, and a table only gets records once a member switches the source on in **Table settings → Connections** and picks which field each piece of data goes to. Records keep a stable id per item, so an order changing later updates its record. When the source changes a value, the record takes it; when it doesn't, a teammate's edit to that field stays. A record a member deleted is never brought back.
- **Map.** With a world pack set up, the Map tab shows the region in 3D: terrain, buildings with their windows and roofs, trees, roads, the sea and its surf, place names and landmarks. It follows the app's theme, with lit windows and streets at night. Records of every table with a Location field show as pins in the color of their stage, and in a list in the corner that filters by table and folds away; clicking either opens the record. A Location field takes coordinates or a pasted Google Maps, Apple Maps or OpenStreetMap link, or a click on the map through the pin button next to the field. Drag to move, right-drag or two fingers to turn and tilt, scroll or pinch to zoom; arrow keys pan and `+`/`-` zoom. The speaker button plays the sounds of what's in view; it starts off.
- **Drive.** With a Blossom server set up, each project has a Drive: folders and files, shown as a tree under the project in the sidebar and on the project page. Files and whole folders go in by dragging them from the computer, picking them or pasting a screenshot, and upload in the background while you move around the app. Pictures, videos, audio, PDFs, texts and CSVs preview in place, a thumbnail is drawn in the browser for pictures, videos and PDFs, and each file has its details and comments, where `@` mentions someone. Any project member can add, rename, move or delete anything; viewers can browse, preview and download. Deleted things wait in the trash for 30 days, then any member's app deletes them for good when they next open the Drive. Stars and recent files are each person's own.
- **Docs.** Each project has docs: pages that can hold pages of their own, shown as a tree under the project in the sidebar. Any project member can write, move or delete any page. Pages are edited in place, as in Notion. Typing `/` opens a menu of blocks, and `@` mentions someone in the project. Hovering a block shows `+`, which adds a block below it, and a handle that drags it somewhere else or opens its menu. List items move on their own, and `Mod+Shift+↑`/`↓` moves the block the cursor is in. Pages in the sidebar can be dragged before, after or into each other. The text is saved as Markdown a second after typing pauses.
- **Catalogs.** Each project can keep catalogs of links: videos, posts, articles, podcasts, music, repos and products the team wants to remember. Pasting or dropping links into a catalog saves them, up to 50 at once, each with an optional note; `Ctrl`/`⌘ K` → Save link does it from anywhere. With a [reader](#reader), each link soon shows a picture, a short title and summary, who made it and when, and is filed under up to three of the catalog's categories; until then it shimmers. Categories the reader would add wait at the end of the catalog's categories, with how many links it suggests them for: adding one files those links there, and dismissing it keeps it from coming back. Adding a category by hand offers to sort the links already saved into it, and the reader says how many it filed. Members can change a link's title, summary, type, creator and categories by hand, and what they set stays over the reader's until someone lets the AI fill it in again. Links show as a gallery or a list, filter by category, platform, type and who saved them, sort and group, and download as CSV. Opening one plays it in place where the platform allows (YouTube, Vimeo, TikTok, X, Spotify and Instagram), beside its details, comments, reactions and the places that mention it. Links can be selected together to file, move to another catalog or project, star or delete, with Undo. Stars, and which links are new to you, are your own: a dot marks links others saved since you last looked, the sidebar counts them, and they're kept on the relay, encrypted, so every device agrees.
- **References.** Typing `#` in a comment, a card's description or a doc page finds a card, page, record, saved link or file of the app by its title, and puts in a link to it that shows as its icon and title. A saved link lists everywhere it's mentioned, under **Mentioned in**: cards and their comments, doc pages, comments on files and other links.
- **Editing a page together.** When two people edit a page at once, each one's saved edits show up in the other's page as they arrive, without moving their cursor. The two versions are merged line by line, so edits to different lines, even neighbouring list items, are all kept. When both change the same line, the person still typing keeps theirs; between two saved versions, every device picks the same one.
- **Search and shortcuts.** `Ctrl`/`⌘ K` opens the command palette. It goes to any project, board, table, catalog, doc page or Drive folder, adds a card, a page or a project, saves a link, changes the theme, and finds cards, doc pages, CRM records, Drive files, saved links and comments as you type, a few of each; typing a card's key, like `FREE-12`, finds that card first. On a card it also changes the status, priority and assignees (`S`, `P` and `A` open those lists straight away), marks it as related to, blocked by or blocking another card (`M` then `R`, `B` or `X`), copies the card's ID or link and deletes it; on a board it switches tabs and layout. `/` opens the search page, which shows every match, narrows to one kind or one project, and keeps the words in its link; on the Drive, `/` searches the Drive instead. Both start with your latest searches and the places you opened lately. `C` adds a card from anywhere: on the board in view, or one of the project you're in, and the card can go on another board before it's made; on a board's sprint tab, and on Boards, it joins the running sprint. On a card, `J` and `K` step through the cards as the tab it was opened from lists them, and `Esc` goes back to the board. `G` then `H`, `I`, `M`, `D` or `F` goes Home, to the inbox, the map, or the docs or Drive of the project you're in; `G` then `P` or `B` picks a project or a board; `Ctrl`/`⌘` with 1 to 9 opens a project, in the sidebar's order; and `Ctrl`/`⌘ B` shows or hides the sidebar. `?` lists them all, as does the account menu.
- **Saving.** Changes show up right away, then go to the signer and on to the relay. Once signed, a change is kept in the browser until every team relay has it, so it survives reloads and time offline. A change still waiting on the signer is lost if the tab closes, and the app warns before that happens.
- **Loading.** Relays only send their newest few hundred events per request, so the app pages back through everything they hold before a board or table counts as loaded, then keeps listening. When a relay drops or closes the connection, it reconnects and catches up on what it missed.
- **Names.** Members' names and avatars come from the lookup relays. Each browser keeps the last 200 it saw, shows them at once and checks them again in the background, so they also show while those relays are down. A name not found is looked for again, less often as time goes on and right away when the device is back online, for as long as it's on screen. Someone with no Nostr profile shows as a short npub, and an avatar whose host doesn't answer shows as a color.
- **Where data goes.** Board data is only sent to the team relays, plus, encrypted, the relays a signer app talks through. Lookup relays only see which profiles are being fetched. With a [reader](#reader), the sites of saved links see the reader fetch them, and OpenRouter and the model's provider see the links, their notes and the catalogs' categories.

### Events

Boards and cards follow the draft kanban NIP used by [kanbanstr](https://github.com/vivganes/kanbanstr). Sprints, projects, the CRM and docs are this app's own extensions.

| Kind | Event | Tags |
| --- | --- | --- |
| 30301 | Board | `d`, `title`, `description`, `code`, `col` (status id, label, order), `p` (members, and viewers as `["p", pubkey, "", "viewer"]`), `a` (project, optional) |
| 30302 | Card | `d`, `a` (board), `title`, `description`, `s` (status), `rank`, `number`, `p` (assignees), `priority`, `due`, `sprint`, `label`, `creator`, `created` |
| 30303 | Sprint | `d`, `a` (board), `title`, `number`, `status`, `start`, `end` |
| 30304 | Project | `d`, `title`, `description`, `slug`, `color`, `p` (members and viewers, as on a board) |
| 30305 | CRM table | `d`, `a` (project), `title`, `singular`, `slug`, `icon`, `description`, `creator`, `created`, `field` (id, type, name, config), `option` (field, id, label, color, stage outcome), `p` (connectors that may write its records), `source` (connector, source), `map` (connector, source, attribute, field), `map-option` (connector, source, attribute, value, option) |
| 30306 | CRM record | `d`, `a` (table), `a` (project), `title`, `rank`, `created`, `creator`, `val` (field, value), `moved` (stage, time, member or connector) |
| 30307 | Doc page | `d`, `a` (project), `title`, `icon`, `parent`, `rank`, `created`, `creator`, `prev` (the version it was edited from), `p` (one per person mentioned), `mention` (person, who mentioned them, when) |
| 30309 | Drive folder | `d`, `a` (project), `name`, `parent`, `color`, `icon`, `created`, `creator`, `trashed` (time, who) |
| 30310 | Drive file | `d`, `a` (project), `name`, `folder`, `size`, `m` (MIME type), `dim`, `duration`, `x` (hash of the encrypted file), `encryption-algorithm`, `decryption-key`, `decryption-nonce`, `thumbnail` (hash, nonce), `creator`, `created`, `updated`, `trashed` (time, who) |
| 30320 | Catalog | `d`, `a` (project), `title`, `description`, `category` (id, name, color), `dismissed` (a suggested category waved away), `sort` (category, when it was asked for), `created`, `creator` |
| 30321 | Saved link | `d`, `a` (project), `catalog`, `r` (its address), `creator`, `created`, `read` (when a new reading was asked for), and what members set by hand: `title`, `summary`, `type`, `byline` (name, address), `filed` (category ids) |
| 30322 | The reader's reading of a link, or how sorting a catalog went | `d` (the link's or the catalog's), `a` (project), `k` (`30321` or `30320`). A reading: `r`, `state`, `read`, `title`, `original`, `summary`, `type`, `byline`, `published`, `duration`, `site`, `thumb` (hash, nonce, key, MIME type), `dim`, `image`, `c` (category ids), `suggest` (category names). A catalog's: `sorted` (category, when, filed, checked) or `unsorted` (category, when, why) |
| 30323 | Two cards marked as related, or one as blocking the other | `d` (both cards' `d` tags, sorted, joined by `:`), `a` (each card's board, once), `rel` (`blocks` or `related`), `from` (the blocking card, or the one it was marked from: `d`, board), `to` (the other card: `d`, board), `deleted` |
| 30308 | Connector source | `d`, `name`, `type`, `attr` (id, type, name, config), `value` (attribute, id, label, color, stage outcome) |
| 1111 | Comment on a card, a Drive file or a saved link, or activity on a card or a record ([NIP-22](https://github.com/nostr-protocol/nips/blob/master/22.md)) | `A`, `K`, `P`, `a`, `k`, `p` (plus one per person mentioned or told), `activity`, `change` (field, from, to; cards only), `field` (records only) |
| 7 | Reaction to a card or a saved link, or to a comment on one ([NIP-25](https://github.com/nostr-protocol/nips/blob/master/25.md)) | `e`, `a` (cards and links only), `p`, `k` |
| 30078 | A person's own app data ([NIP-78](https://github.com/nostr-protocol/nips/blob/master/78.md)): inbox marks, subscriptions, Home settings, catalog stars and what's new, or a device to push to | `d` (`freehub/inbox`, `freehub/subscriptions`, `freehub/home`, `freehub/catalogs` or `freehub/push/<device>`), `p` (who can read it), `subscribed` and `unsubscribed` (`kind:id`), `deleted` |
| 5 | Deleted board, project, comment or reaction ([NIP-09](https://github.com/nostr-protocol/nips/blob/master/09.md)) | `a` or `e`, `k` |

`d` tags are 16 random hex characters, so every address (`kind:pubkey:d`) stays under the 100 characters that relays built on [eventstore](https://github.com/fiatjaf/eventstore), Haven among them, index for `#a` queries. Boards and projects made before that used longer `d` tags, so their cards, sprints, tables, records and comments are fetched by author instead and matched by address in the browser.

A board's `col` tags are the statuses it uses, one per column, and a card's `s` tag holds its status's label, as the kanban NIP has them. A status the board doesn't use still gets a column while a card is in it, so no card drops out of sight.

Each member publishes their own version of a card, sprint, CRM table, record or doc page under the same `d` tag, and the newest version from any member wins. Two cards' relation works the same way, one event per pair whichever side marks it: marking them another way publishes a newer version, and unmarking them one tagged `deleted`. Since it names both boards in `a` tags, each board loads it with its own cards, and it counts only from someone who is a member of both. Deleting one publishes a new version tagged `deleted`. A record keeps one `val` tag per value, so a multi-select holds several, and field values are stored as plain text: numbers as decimals, dates as `YYYY-MM-DD`, places as `lat,lng` in degrees, members as hex pubkeys and links to other records by their `d` tag.

A connector publishes a source manifest per source, and a kind 0 profile with its name on the team relays. A table switches a source on with a `source` tag and maps its attributes with `map` and `map-option` tags; its `p` tags name the connectors allowed to write its records, so a connector finds its tables with a `#p` query. Besides members, a record's versions count from those connectors only, and only in that table. A connector's record has `creator` set to the connector and a `d` tag made from the table, the source and the item's id, so the same order always lands on the same record.

A Drive file's blob is sealed with AES-GCM under a key made for that file; its thumbnail uses the same key with a nonce of its own. The encryption tags follow NIP-17's file messages, and `x` is the SHA-256 of the encrypted blob, which is the name the Blossom servers know it by. A folder or file put in the trash gets a `trashed` tag, and what's inside a trashed folder goes with it untagged. Deleting one for good publishes a version tagged `deleted`, as for cards; a file's still names its blobs and `creator`, so the uploader's app deletes them from the servers, since only the uploader's key can.

What happens to a card is a comment on it with an `activity` tag: `change`, with a `change` tag per value (`["change", "status", "todo", "done"]`, or `["change", "assignee", "", <pubkey>]` for someone assigned), or `mention` for people picked into its description. A card marked against another names that card by its `d` tag, then its board, key and title at the time, so the entry still reads once it's renamed or deleted: `["change", "blockedBy", "", <d>, <board address>, "OPS-4", <title>]`, with the `d` tag in the from slot when it's unmarked. The entry's text, and the activity of someone who isn't on the other card's board, name that card by its key alone. Marking two cards puts an entry on each. Other Nostr clients show these as comments. A comment or activity entry has a `p` tag for everyone told about it; a subscriber's carries the role `subscriber` after the relay hint, as `["p", pubkey, "", "subscriber"]`, so the relay routes it and the inbox knows why it came. Whoever writes it works out the subscribers: the card's creator and assignees, and whoever subscribed by choice, less whoever unsubscribed, from each person's `freehub/subscriptions` list. A record's assignment is an entry with `activity` `assigned` and the member field in `field`.

A reaction's content is its emoji, and taking it back deletes it. One to a card names the card's address in `a`, which every member's version shares, so it outlasts the version it was made on; one to a comment names the comment in `e`. Reactions tell no one. Another client's `+` reads as 👍; dislikes and custom emoji don't show.

Inbox marks and devices are encrypted with NIP-44 between their author and the person in their `p` tag: the notifier when there is one, so it can skip what was read and push to the device, or else the author. Marks keep up to 1000 read and 1000 archived notifications, by their ids, an event id cut to 16 characters.

Home settings are encrypted with NIP-44 to their author alone. The content is JSON: the sections, the filters and the view, each with when it last changed, and a mark per pin with whether it's pinned, when that changed and its place among the pins. When two devices' copies meet, the newest of each setting and of each pin wins. Unpinned marks are kept a while, so an older copy can't pin something again.

Catalog marks are encrypted the same way: the links starred, each with when that changed, and per catalog the time up to which everything was seen, plus the links seen after it. A link is new to someone when another member saved it after that time; before they've seen anything, that's when their marks were first made, so no one starts with everything new.

A saved link is versioned like a card, and its content is the note saved with it. What the reader read of it is an event of its own, from the reader's key alone, since only the npub in `config.json` counts: the app shows the link's own tags over the reading's, so a hand edit stays whatever the reader reads later. A `read` tag with the current time asks for a new reading, which the reader answers with a `read` time as late; until then, with a reader set up, the link shows as being read. The picture is sealed with AES-GCM under a key made for it, carried in the `thumb` tag; without a Blossom server, `image` names the picture on the web instead. Asking to sort a catalog's links into a category adds a `sort` tag to the catalog, and the reader files each link it picks by adding the category to the link's reading, then saves how it went in the catalog's report. A suggested category that a member adds files the links that suggested it, unless someone filed them by hand. Moving a link to another project saves it there under a new `d` tag and deletes it where it was. An hour after a link or its catalog is deleted, the reader deletes its reading, and its picture from the Blossom server.

A doc page's text is the event's content, as Markdown. Its `parent` is the `d` tag of the page it sits under, and pages at the top have none. `prev` is the id of the version the editor started from, so a teammate's editor knows what each side changed when it merges two versions saved at once. Deleting a page deletes the pages under it too. Everyone the text mentions gets a `p` tag, and a `mention` tag with who mentioned them and when, in seconds; each version carries these on from the one it was edited from, so every member's version names the same notification, and the newest time wins when they differ.

## Project layout

| Path | Holds |
| --- | --- |
| `src/config.ts` | Loading and checking `config.json` |
| `src/lib/model.ts` | Event kinds, boards, cards and sprints |
| `src/lib/project.ts` | Projects |
| `src/lib/crm.ts` | CRM tables, fields, records and activity |
| `src/lib/crm-templates.ts` | The table templates offered in "New table" |
| `src/lib/sources.ts` | Connector sources and how they map onto tables |
| `src/lib/docs.ts` | Doc pages and how they nest |
| `src/lib/drive.ts` | Drive folders and files, and how they nest |
| `src/lib/blossom.ts`, `src/lib/sealing.ts` | Blossom servers, and sealing files before they go there |
| `src/lib/catalogs.ts` | Catalogs, saved links and the reader's readings, and how they layer; the reader shares it |
| `src/lib/catalog-actions.ts` | Saving, editing, filing, moving and deleting links |
| `src/lib/catalog-marks.ts`, `src/lib/catalog-store.ts` | Each person's stars and what's new in catalogs, kept on the relay |
| `src/lib/refs.ts`, `src/features/search/ref-search.tsx` | `#` references and what they find |
| `src/lib/private-doc.ts` | A person's own data, encrypted to them and kept on the relay |
| `src/lib/drive-upload.ts` | The upload queue, carried on across screens |
| `src/lib/merge.ts` | Merging two edits of the same page |
| `src/lib/mentions.ts` | Mentions in comments and docs (NIP-27) |
| `src/components/app-link.tsx` | Links to the app, shown as what they go to |
| `src/lib/search.ts`, `src/features/search/` | Search: matching words, snippets, and what's searched |
| `src/lib/shortcuts.ts`, `src/features/shortcuts/` | Every keyboard shortcut, the cheat sheet, and the commands they run |
| `src/features/palette/` | The command palette, and what pages offer in it |
| `src/lib/recents.ts` | Recent searches and places, kept in the browser |
| `src/lib/notifications.ts` | The rules that turn events into notifications |
| `src/lib/notification-targets.ts` | Checking a notification against what it points at |
| `src/lib/card-activity.ts` | A card's history: its changes and mentions |
| `src/lib/reactions.ts` | Reactions to cards and comments |
| `src/lib/subscriptions.ts` | Who subscribes to what |
| `src/lib/inbox-marks.ts`, `src/lib/inbox.ts` | What each person read or archived, kept on the relay |
| `src/lib/home.ts`, `src/lib/home-store.ts` | Each person's Home: pins, sections, filters and view, kept on the relay |
| `src/lib/push-devices.ts`, `src/lib/notify.ts` | Devices to push to, and notifications on this one |
| `src/lib/pwa.ts`, `src/lib/updates.ts`, `public/sw.js` | Installing the app, opening it offline, and updating it |
| `src/lib/team-relay.ts` | The team relay as the services see it |
| `src/lib/connected-tables.ts` | The tables that switched on a service's sources, and their records |
| `src/lib/relays.ts` | Team relay connections, AUTH and access |
| `src/lib/publish.ts` | Optimistic edits, signing and the outbox |
| `src/lib/location.ts` | Reading places typed or pasted into the CRM |
| `src/components/ui/` | shadcn/ui components, including the sidebar |
| `src/features/` | Screens |
| `src/features/map/engine/` | The 3D map: three.js, no React or app code |
| `tools/world/` | Bakes an OpenStreetMap region into a world pack |
| `connector/` | The optional service that feeds sources, like a store, into tables |
| `notifier/` | The optional service that pushes notifications to people's devices |
| `reader/` | The optional service that reads, titles and files the links saved to catalogs |
| `btcmap/` | The optional service that keeps BTC Map in line with a merchants table |
| `vite.service.ts`, `tsconfig.service.json` | The build and type settings the services share |

## Known limits

- Card numbers are picked as highest + 1 on each device, so two people adding cards at the same moment can get the same number.
- Board codes and project links are checked against every board and project on the relay, but two made at the same moment can still match. Links then name the board with `?board=`, and one of the projects gets a `-2` link.
- Removing someone from a board or project, or making them a viewer, hides the cards, sprints, CRM tables, records and doc pages whose newest version is theirs: each falls back to an older version or disappears, a table with its records. Comments on their versions are hidden too, and boards they made in a project move out of it. Adding them back as a member shows it all again.
- Other clients of the kanban NIP, and copies of this app from before viewers, read a viewer as a member.
- The statuses are fixed, after Linear's: Triage, Backlog, Todo, In progress, In review, Done, Canceled and Duplicate. Each board picks which of them it uses, but can't rename or reorder them. Boards made before these statuses use To do, In progress and Done until their creator turns more on. Copies of this app from before these statuses read the new ones as Todo.
- Cards and doc pages can't hold files yet; files go in a project's Drive.
- A Drive file is encrypted and opened whole, in memory, so files are capped at 100 MB, and a video plays once it has all arrived.
- Only the person who uploaded a file can delete it from the Blossom servers, and their app does so the next time they open the Drive after it was deleted for good. Files deleted after their uploader left the team stay on the servers, encrypted, with nothing pointing at them.
- The Drive's stars and recent files are kept in the browser, so another device starts without them. So are recent searches and the places opened lately.
- Search runs in the browser, through what it has from the relays. The first search after the app opens waits for every card, record, file and comment to load, and a team with many thousands of them makes each search slower.
- Two people adding something with the same name to the same folder at the same moment both keep it; the Drive numbers names only as they're added from one device.
- A linked image in a description, such as a `[![badge](…)](…)` badge, loses its link once the description is edited.
- A CRM record is saved as a whole, so two people changing different fields of the same record at the same moment can undo one another's change.
- Importing a CSV signs one event per row; a signer app may ask to approve each one. At most 500 rows go in per import.
- A record remembers its last 100 stage changes.
- A connector writes a mapped field only when the source changes it, so a teammate's edit stays until then, and is then replaced.
- A connector stays allowed to write a table's records after its source is switched off, so the records it wrote stay.
- The BTC Map sync only reports what it would do. Writing to OpenStreetMap is still to come, and an unattended edit has to follow OpenStreetMap's [Automated Edits code of conduct](https://wiki.openstreetmap.org/wiki/Automated_Edits_code_of_conduct) first: documented, announced to the local community, from an account that says it's a bot.
- The BTC Map sync reads one address format so far, Portugal's.
- A doc page is saved whole, as one event, so a long page costs a little more with each save. Edits merge line by line: a paragraph is one line, so two people rewriting the same paragraph at once keep only one version of it.
- A deleted page can't be brought back. Deleting a page while someone else has it open drops whatever they hadn't saved yet.
- Only saved links list where they're mentioned; cards, pages, records and files don't yet.
- The reader reads what a page says about itself in its head, as link previews do, so a page that only fills that in with scripts, or that turns robots away, is read by its address alone.
- Links are saved up to 50 at once, and filed, moved or deleted up to 500 at once.
- The inbox shows the newest 200 comments and activity entries of each kind that name you, and the newest 200 versions of pages and of cards assigned to you. With a signer that can't encrypt (NIP-44), what you read or archived stays in the browser, and the notifier can't push to you.
- Whoever changes a card works out who subscribes, so someone who subscribed a moment before, on another device, may miss that change. Changes made by other Nostr clients, or by copies of this app from before the history, tell no one and don't show in it.
- Due reminders go out at 9:00 the day before: in each device's own time zone in the app, and in the notifier's `TZ` for pushes.
- The map needs WebGL 2. It draws one region per app, and a pin per record, so thousands of located records crowd it.
- The map guesses most building heights, since few are tagged in OpenStreetMap, and builds windows and roofs from rules rather than the real buildings.
- `INBOX`, `MAP` and `SEARCH` can't be board codes, since the inbox lives at `/inbox`, the map at `/map` and search at `/search`. Likewise a table named "Docs", "Drive" or "Catalogs" gets the link `docs-2`, `drive-2` or `catalogs-2`, since a project's docs, Drive and catalogs live at `/p/<project>/docs`, `/p/<project>/drive` and `/p/<project>/catalogs`.
