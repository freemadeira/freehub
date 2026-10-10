/**
 * Checks a notification against what it points at, as things stand: the
 * card, page, file or record must still be there, whoever did it must be a
 * member, the recipient must be able to read it, and a mention, assignment
 * or due date must still hold. The inbox and the notifier only deliver what
 * passes. No browser APIs here.
 */
import type { NostrEvent } from "applesauce-core/helpers/event";

import type { CrmRecord, CrmTable } from "@/lib/crm";
import { resolveRecord } from "@/lib/crm";
import type { DocPage } from "@/lib/docs";
import { resolvePage } from "@/lib/docs";
import type { DriveFile } from "@/lib/drive";
import { resolveFile } from "@/lib/drive";
import { mentions } from "@/lib/mentions";
import type { Board, Card, Membership } from "@/lib/model";
import {
  addressedId,
  CARD_KIND,
  CRM_RECORD_KIND,
  CRM_TABLE_KIND,
  DOC_PAGE_KIND,
  DRIVE_FILE_KIND,
  isClosed,
  resolveCard,
} from "@/lib/model";
import type {
  CardNotification,
  FileNotification,
  Notification,
  PageNotification,
  RecordNotification,
} from "@/lib/notifications";
import { pageNotification } from "@/lib/notifications";
import type { Project } from "@/lib/project";

/** What the one delivering notifications knows. */
export interface NotificationScope {
  boards: Board[];
  projects: Project[];
  /** Every version known of the card, page, file or record with this `d` tag. */
  versions: (kind: number, id: string) => NostrEvent[];
  /** A project's CRM tables. */
  tables: (project: Project) => CrmTable[];
}

export type NotificationTarget =
  | { notification: CardNotification; board: Board; card: Card }
  | { notification: PageNotification; project: Project; page: DocPage }
  | { notification: FileNotification; project: Project; file: DriveFile }
  | {
      notification: RecordNotification;
      project: Project;
      table: CrmTable;
      record: CrmRecord;
    };

function canRead({ members, viewers }: Membership, pubkey: string): boolean {
  return members.includes(pubkey) || viewers.includes(pubkey);
}

/** Boards or projects the recipient can read, where whoever did it is a member. */
function places<T extends Membership>(
  all: T[],
  notification: Notification,
  recipient: string
): T[] {
  const { actor } = notification;
  return all.filter(
    (place) =>
      canRead(place, recipient) &&
      (actor === undefined || place.members.includes(actor))
  );
}

/** Whether what the notification says of the card is still so. */
function stillHolds(
  notification: CardNotification,
  card: Card,
  recipient: string
): boolean {
  if (notification.reason === "description") {
    return mentions(card.description, recipient);
  }
  if (notification.reason === "due") {
    return (
      card.due === notification.due &&
      card.assignees.includes(recipient) &&
      !isClosed(card.status)
    );
  }
  return true;
}

function locateCard(
  notification: CardNotification,
  recipient: string,
  scope: NotificationScope
): NotificationTarget | undefined {
  const versions = scope.versions(CARD_KIND, notification.cardId);
  for (const board of places(scope.boards, notification, recipient)) {
    const card = resolveCard(board, versions, notification.cardId);
    if (card) {
      return stillHolds(notification, card, recipient)
        ? { board, card, notification }
        : undefined;
    }
  }
  return undefined;
}

/**
 * The page, if its newest version still mentions the recipient as the
 * notification says. The notification is read again from that version, with
 * the words as they are now.
 */
function locatePage(
  notification: PageNotification,
  recipient: string,
  scope: NotificationScope
): NotificationTarget | undefined {
  const project = places(scope.projects, notification, recipient).find(
    (item) => item.address === notification.project
  );
  const page =
    project &&
    resolvePage(
      project,
      scope.versions(DOC_PAGE_KIND, notification.pageId),
      notification.pageId
    );
  const current = page && pageNotification(page.event, recipient);
  return project && page && current?.id === notification.id
    ? { notification: current, page, project }
    : undefined;
}

function locateFile(
  notification: FileNotification,
  recipient: string,
  scope: NotificationScope
): NotificationTarget | undefined {
  const versions = scope.versions(DRIVE_FILE_KIND, notification.fileId);
  for (const project of places(scope.projects, notification, recipient)) {
    const file = resolveFile(project, versions, notification.fileId);
    if (file) {
      return { file, notification, project };
    }
  }
  return undefined;
}

function locateRecord(
  notification: RecordNotification,
  recipient: string,
  scope: NotificationScope
): NotificationTarget | undefined {
  const versions = scope.versions(CRM_RECORD_KIND, notification.recordId);
  const tableIds = new Set(
    versions.flatMap((event) => addressedId(event, CRM_TABLE_KIND) ?? [])
  );
  for (const project of places(scope.projects, notification, recipient)) {
    for (const table of scope.tables(project)) {
      const record = tableIds.has(table.id)
        ? resolveRecord(project, table, versions, notification.recordId)
        : undefined;
      if (!record) {
        continue;
      }
      const holds =
        notification.reason !== "assigned" ||
        (table.fields.some(
          ({ id, type }) => id === notification.field && type === "member"
        ) &&
          (record.values[notification.field] ?? []).includes(recipient));
      return holds ? { notification, project, record, table } : undefined;
    }
  }
  return undefined;
}

/** What the notification points at, if it should still reach the recipient. */
export function locateNotification(
  notification: Notification,
  recipient: string,
  scope: NotificationScope
): NotificationTarget | undefined {
  switch (notification.type) {
    case "card": {
      return locateCard(notification, recipient, scope);
    }
    case "page": {
      return locatePage(notification, recipient, scope);
    }
    case "file": {
      return locateFile(notification, recipient, scope);
    }
    default: {
      return locateRecord(notification, recipient, scope);
    }
  }
}
