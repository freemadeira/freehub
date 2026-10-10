import { createServer } from "node:http";

import { EventStore } from "applesauce-core/event-store";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import { getDisplayName } from "applesauce-core/helpers/profile";
import { unixNow } from "applesauce-core/helpers/time";
import { RelayPool } from "applesauce-relay";
import { catchError, lastValueFrom, of, timeout, toArray } from "rxjs";

import { notificationPath } from "@/features/inbox/notification-path";
import { notificationMessage } from "@/features/inbox/notification-text";
import { resolveTables } from "@/lib/crm";
import type { InboxMarks } from "@/lib/inbox-marks";
import {
  INBOX_D,
  isArchived,
  isRead,
  marksReader,
  parseMarks,
} from "@/lib/inbox-marks";
import {
  APP_DATA_KIND,
  BOARD_KIND,
  CARD_KIND,
  COMMENT_KIND,
  CRM_RECORD_KIND,
  CRM_TABLE_KIND,
  DELETE_KIND,
  DOC_PAGE_KIND,
  DRIVE_FILE_KIND,
  isPubkey,
  parseBoard,
  PROJECT_KIND,
} from "@/lib/model";
import type {
  NotificationScope,
  NotificationTarget,
} from "@/lib/notification-targets";
import { locateNotification } from "@/lib/notification-targets";
import type { Notification } from "@/lib/notifications";
import {
  deriveNotifications,
  hasArrived,
  notificationSubject,
} from "@/lib/notifications";
import { distinctSlugs, parseProject } from "@/lib/project";
import type { PushDevice } from "@/lib/push-devices";
import { isDeviceEvent, parsePushDevice } from "@/lib/push-devices";
import {
  cardSubject,
  parseSubscriptions,
  SUBSCRIPTIONS_D,
} from "@/lib/subscriptions";
import { TeamRelay } from "@/lib/team-relay";
import { errorMessage, shortNpub } from "@/lib/utils";

import type { NotifierConfig } from "./config";
import { loadConfig } from "./config";
import type { PushMessage } from "./push";
import { generateVapidKeys, push, setUpPush } from "./push";
import { SentLog } from "./sent";

/** How old news can be and still get pushed, in seconds: a restart catches up this far. */
const MAX_AGE = 60 * 60;
/** How often everything is asked for again, to catch what a dropped connection missed. */
const REFRESH_INTERVAL = 10 * 60_000;
/** Asking again starts this long before the last time, in seconds, for clocks a little apart. */
const REFRESH_OVERLAP = 5 * 60;
/** How often due dates are looked at for reminders. */
const DUE_INTERVAL = 60_000;
const NAME_TTL = 60 * 60_000;
const NAME_TIMEOUT = 5000;

/** What notifications point at, kept whole, so each can be checked before it's pushed. */
const POINTED_AT = [
  BOARD_KIND,
  PROJECT_KIND,
  CARD_KIND,
  CRM_TABLE_KIND,
  CRM_RECORD_KIND,
  DOC_PAGE_KIND,
  DRIVE_FILE_KIND,
];

interface Pending {
  notification: Notification;
  recipient: string;
  timer: ReturnType<typeof setTimeout>;
}

/** Runs the task, logging rather than throwing if it fails: the next one may work. */
async function reportFailure(
  what: string,
  task: () => Promise<unknown>
): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.error(`${what} failed: ${errorMessage(error)}`);
  }
}

/** Whether the notification's id is an event's, which goes if the event is deleted. */
function fromEvent(notification: Notification): boolean {
  return notification.type !== "page" && !notification.id.startsWith("due:");
}

/** People the notification names: who did it, and anyone a change was about. */
function peopleIn({ notification }: NotificationTarget): string[] {
  const changed =
    notification.type === "card" && notification.reason === "change"
      ? notification.changes.flatMap((change) =>
          change.field === "assignees"
            ? [...change.added, ...change.removed]
            : []
        )
      : [];
  return [
    ...new Set([
      ...(notification.actor ? [notification.actor] : []),
      ...changed,
    ]),
  ];
}

class Notifier {
  readonly relay: TeamRelay;
  private readonly config: NotifierConfig;
  private readonly store = new EventStore();
  private readonly sent: SentLog;
  private readonly lookup = new RelayPool();
  private readonly pending = new Map<string, Pending>();
  /** Endpoints push services said are gone. */
  private readonly gone = new Set<string>();
  /** Decrypted marks and devices, by the event they came from. */
  private readonly opened = new Map<string, string | undefined>();
  private readonly names = new Map<string, { name: string; at: number }>();
  private fetchedAt = 0;
  /**
   * On a first start, news already there counts as told: pushing the last
   * hour to everyone would be noise, and would repeat on every start if the
   * notifier's volume went missing.
   */
  private quiet = false;
  /**
   * Whether the first load is in. News is only weighed after it, with the
   * marks and devices it needs, which may arrive after the news itself.
   */
  private ready = false;

  constructor(config: NotifierConfig, pubkey: string) {
    this.config = config;
    this.relay = new TeamRelay(config.relay, config.signer, pubkey);
    this.sent = new SentLog(config.stateFile);
    setUpPush(config.vapid);
  }

  /** Everything the notifier keeps. */
  private filters(): Filter[] {
    return [
      { kinds: POINTED_AT },
      // Inbox marks and devices, encrypted to the notifier.
      { "#p": [this.relay.pubkey], kinds: [APP_DATA_KIND] },
      { "#d": [SUBSCRIPTIONS_D], kinds: [APP_DATA_KIND] },
      {
        "#k": [String(BOARD_KIND), String(PROJECT_KIND)],
        kinds: [DELETE_KIND],
      },
      { kinds: [COMMENT_KIND] },
      { kinds: [DELETE_KIND] },
    ];
  }

  /**
   * The same, from `since` on. Only recent news is pushed, so comments and
   * deletions older than that aren't needed, even on the first load.
   */
  private filtersSince(since: number | undefined): Filter[] {
    const recent = Math.max(since ?? 0, unixNow() - MAX_AGE);
    return this.filters().map((filter) =>
      filter.kinds?.includes(COMMENT_KIND) ||
      (filter.kinds?.includes(DELETE_KIND) && !filter["#k"])
        ? { ...filter, since: recent }
        : { ...filter, ...(since === undefined ? {} : { since }) }
    );
  }

  private add(event: NostrEvent): void {
    if (this.store.add(event) && this.ready) {
      this.consider(event);
    }
  }

  /** Fetches what's changed since the last time, and pushes the news in it. */
  private async refresh(): Promise<number> {
    const since =
      this.fetchedAt === 0 ? undefined : this.fetchedAt - REFRESH_OVERLAP;
    const started = unixNow();
    let count = 0;
    for (const filter of this.filtersSince(since)) {
      // oxlint-disable-next-line no-await-in-loop -- one filter at a time, as Haven pages them
      const events = await this.relay.fetch(filter);
      for (const event of events) {
        this.add(event);
      }
      count += events.length;
    }
    this.fetchedAt = started;
    return count;
  }

  async start(): Promise<void> {
    this.relay.start(this.filters(), (event) => this.add(event));
    await this.relay.authenticated();
    console.log(`Connected to ${this.config.relay} as ${this.relay.pubkey}`);
    console.log(`Loaded ${await this.refresh()} events`);
    this.quiet = this.sent.fresh;
    this.ready = true;
    for (const event of this.store.getByFilters({
      kinds: [COMMENT_KIND, DOC_PAGE_KIND],
      since: unixNow() - MAX_AGE,
    })) {
      this.consider(event);
    }
    this.remind();
    if (this.quiet) {
      this.quiet = false;
      this.sent.save();
      console.log("First start: news from before now counts as told");
    }
    setInterval(() => {
      reportFailure("Refresh", () => this.refresh());
    }, REFRESH_INTERVAL);
    setInterval(() => this.remind(), DUE_INTERVAL);
  }

  /** Whoever the event may be news to: everyone it routes to with `p` tags. */
  private consider(event: NostrEvent): void {
    if (event.created_at < unixNow() - MAX_AGE) {
      return;
    }
    const recipients = new Set(
      event.tags.flatMap(([name, pubkey]) =>
        name === "p" && isPubkey(pubkey) ? [pubkey] : []
      )
    );
    for (const recipient of recipients) {
      for (const notification of deriveNotifications([event], recipient)) {
        this.schedule(notification, recipient);
      }
    }
  }

  /** Reminders of due dates whose time came. */
  private remind(): void {
    for (const card of this.store.getByFilters({ kinds: [CARD_KIND] })) {
      this.consider({ ...card, created_at: unixNow() });
    }
  }

  /**
   * Waits a little before pushing, so news read meanwhile, or a run of news
   * about one thing, goes out once or not at all.
   */
  private schedule(notification: Notification, recipient: string): void {
    const key = `${recipient}:${notification.id}`;
    const now = unixNow();
    if (
      !hasArrived(notification, now) ||
      notification.createdAt < now - MAX_AGE ||
      this.sent.has(key) ||
      this.pending.has(key)
    ) {
      return;
    }
    if (this.quiet) {
      this.sent.add(key, notification.createdAt);
      return;
    }
    // Never longer than the delay, whatever the clock that stamped it says.
    const wait = Math.min(
      this.config.delay,
      Math.max(0, notification.createdAt + this.config.delay - now)
    );
    this.pending.set(key, {
      notification,
      recipient,
      timer: setTimeout(() => {
        reportFailure("Push", () => this.deliver(key));
      }, wait * 1000),
    });
  }

  private async deliver(key: string): Promise<void> {
    const item = this.pending.get(key);
    if (!item) {
      return;
    }
    this.pending.delete(key);
    const { notification, recipient } = item;
    // Taken before the push goes out, so the next look can't schedule it again.
    this.sent.add(key, notification.createdAt);
    const subject = notificationSubject(notification);
    // Newer news about the same thing goes out instead, saying what's newest.
    const superseded = [...this.pending.values()].some(
      (other) =>
        other.recipient === recipient &&
        notificationSubject(other.notification) === subject &&
        other.notification.createdAt >= notification.createdAt
    );
    this.sent.prune(unixNow() - 2 * MAX_AGE);
    this.sent.save();
    if (!superseded) {
      await this.tell(notification, recipient);
    }
  }

  private async tell(
    notification: Notification,
    recipient: string
  ): Promise<void> {
    if (fromEvent(notification) && !this.store.hasEvent(notification.id)) {
      return;
    }
    const target = locateNotification(
      notification,
      recipient,
      this.scope(recipient)
    );
    if (
      !target ||
      (notification.type === "card" &&
        !notification.direct &&
        this.unsubscribed(recipient).has(
          cardSubject({ id: notification.cardId })
        ))
    ) {
      return;
    }
    const marks = await this.marks(recipient);
    if (
      marks &&
      (isRead(marks, notification.id) || isArchived(marks, notification.id))
    ) {
      return;
    }
    const devices = await this.devices(recipient);
    if (devices.length === 0) {
      return;
    }
    await this.loadNames(peopleIn(target));
    const message: PushMessage = {
      ...notificationMessage(target, recipient, (pubkey) => this.name(pubkey)),
      at: notification.createdAt,
      path: notificationPath(target),
      tag: notificationSubject(notification),
    };
    const outcomes = await Promise.all(
      devices.map(async (device) => {
        const outcome = await push(device, message);
        if (outcome === "gone") {
          this.gone.add(device.endpoint);
        }
        return outcome;
      })
    );
    const delivered = outcomes.filter((outcome) => outcome === "sent").length;
    console.log(
      `${notification.type} news for ${shortNpub(recipient)}: ${delivered}/${devices.length} devices`
    );
  }

  /** What the recipient can see, as their app works it out. */
  private scope(recipient: string): NotificationScope {
    const theirs = (kind: number) =>
      this.store.getByFilters([
        { authors: [recipient], kinds: [kind] },
        { "#p": [recipient], kinds: [kind] },
      ]);
    return {
      boards: theirs(BOARD_KIND).flatMap((event) => parseBoard(event) ?? []),
      projects: distinctSlugs(
        theirs(PROJECT_KIND).flatMap((event) => parseProject(event) ?? [])
      ),
      tables: (project) =>
        resolveTables(
          project,
          this.store.getByFilters({
            "#a": [project.address],
            kinds: [CRM_TABLE_KIND],
          })
        ),
      versions: (kind, id) =>
        this.store.getByFilters({ "#d": [id], kinds: [kind] }),
    };
  }

  private unsubscribed(recipient: string): ReadonlySet<string> {
    return parseSubscriptions(
      this.store.getReplaceable(APP_DATA_KIND, recipient, SUBSCRIPTIONS_D)
    ).off;
  }

  /** The text of one of the person's events encrypted to the notifier. */
  private async open(event: NostrEvent): Promise<string | undefined> {
    if (this.opened.has(event.id)) {
      return this.opened.get(event.id);
    }
    let text: string | undefined;
    try {
      text = await this.config.signer.nip44.decrypt(
        event.pubkey,
        event.content
      );
    } catch {
      text = undefined;
    }
    this.opened.set(event.id, text);
    return text;
  }

  /** What the person read or archived, if they let the notifier see it. */
  private async marks(recipient: string): Promise<InboxMarks | undefined> {
    const event = this.store.getReplaceable(APP_DATA_KIND, recipient, INBOX_D);
    if (!event || marksReader(event) !== this.relay.pubkey) {
      return undefined;
    }
    const text = await this.open(event);
    return text === undefined ? undefined : parseMarks(text);
  }

  /** The person's devices that take pushes, each once. */
  private async devices(recipient: string): Promise<PushDevice[]> {
    const events = this.store
      .getByFilters({
        "#p": [this.relay.pubkey],
        authors: [recipient],
        kinds: [APP_DATA_KIND],
      })
      .filter(isDeviceEvent);
    const devices = await Promise.all(
      events.map(async (event) => {
        const text = await this.open(event);
        return text === undefined ? undefined : parsePushDevice(text);
      })
    );
    const byEndpoint = new Map(
      devices.flatMap((device) =>
        device && !this.gone.has(device.endpoint)
          ? [[device.endpoint, device] as const]
          : []
      )
    );
    return [...byEndpoint.values()];
  }

  /** Fetches the names of people not known lately from the lookup relays. */
  private async loadNames(people: string[]): Promise<void> {
    const now = Date.now();
    const missing = people.filter(
      (pubkey) => (this.names.get(pubkey)?.at ?? 0) < now - NAME_TTL
    );
    if (missing.length === 0) {
      return;
    }
    const profiles = await lastValueFrom(
      this.lookup
        .request(this.config.lookupRelays, { authors: missing, kinds: [0] })
        .pipe(
          toArray(),
          timeout(NAME_TIMEOUT),
          catchError(() => of([] as NostrEvent[]))
        )
    );
    for (const pubkey of missing) {
      const [newest] = profiles
        .filter((profile) => profile.pubkey === pubkey)
        .toSorted((a, b) => b.created_at - a.created_at);
      this.names.set(pubkey, {
        at: now,
        name: getDisplayName(newest) ?? shortNpub(pubkey),
      });
    }
  }

  private name(pubkey: string): string {
    return this.names.get(pubkey)?.name ?? shortNpub(pubkey);
  }

  stop(): void {
    this.sent.save();
    this.relay.close();
  }
}

async function serve(config: NotifierConfig): Promise<void> {
  const notifier = new Notifier(config, await config.signer.getPublicKey());
  await notifier.start();
  // For the host's health check.
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
  });
  server.listen(config.port, () => console.log(`Listening on ${config.port}`));
  process.once("SIGTERM", () => {
    server.close();
    notifier.stop();
    process.exit(0);
  });
}

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  if (command === "vapid") {
    // Run once, then keep both keys: browsers subscribe to the public one.
    const keys = generateVapidKeys();
    console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
    console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
    return;
  }
  if (command !== undefined) {
    throw new Error(`Unknown command "${command}".`);
  }
  await serve(loadConfig());
}

try {
  await main();
} catch (error) {
  console.error(errorMessage(error));
  process.exit(1);
}
