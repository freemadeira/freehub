import { cn } from "cn";
import {
  ChartNoAxesColumnIcon,
  CircleDashedIcon,
  CopyIcon,
  LinkIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";

import { copyAndTell } from "@/components/copy";
import { UserAvatar } from "@/components/user-avatar";
import { useBoard } from "@/features/board/board-context";
import {
  assignable,
  PRIORITY_STYLES,
  RELATION_STYLES,
  STATUS_STYLES,
} from "@/features/card/card-fields";
import { PriorityNoneIcon } from "@/features/card/priority-icons";
import { MARK_AS } from "@/features/card/relation-picker";
import { usePageCommands } from "@/features/palette/page-commands";
import { useOpenPalette } from "@/features/palette/palette-context";
import type { SearchItem, SearchPage } from "@/features/search/search-item";
import { useProfileNames } from "@/hooks/use-profile-names";
import { useShortcuts } from "@/hooks/use-shortcut";
import { updateCard } from "@/lib/actions";
import type { Card, Relation } from "@/lib/model";
import { cardKey, inStatusOrder, PRIORITIES, statusLabel } from "@/lib/model";
import { cardPath } from "@/lib/paths";
import { SHORTCUTS } from "@/lib/shortcuts";

const ICON = "text-muted-foreground size-4";
const NOW = "Now";

/**
 * What can be done to the open card from the command palette: its status,
 * priority and people, marking it, copying it and deleting it. S, P and A
 * open the palette straight on its status, priority and people.
 */
export function useCardCommands({
  card,
  onDelete,
  onMark,
}: {
  card: Card;
  onDelete: () => void;
  onMark: (relation: Relation) => void;
}) {
  const { board, boardQuery, canEdit, pubkey } = useBoard();
  const openPalette = useOpenPalette();
  const key = cardKey(board, card);
  const mine = card.assignees.includes(pubkey);
  // Those who left the board stay listed while they're on the card.
  const people = assignable(board, card.assignees);
  const names = useProfileNames(people);
  const toggle = (person: string) =>
    updateCard(board, card, {
      assignees: card.assignees.includes(person)
        ? card.assignees.filter((each) => each !== person)
        : [...card.assignees, person],
    });

  const statusPage: SearchPage = {
    // A card can keep a status its board no longer uses.
    items: () =>
      inStatusOrder([...board.statuses, card.status]).map((status) => {
        const { icon: Icon, className } = STATUS_STYLES[status];
        return {
          context: status === card.status ? NOW : undefined,
          icon: <Icon aria-hidden className={cn("size-4", className)} />,
          key: `status:${status}`,
          run: () => updateCard(board, card, { status }),
          title: statusLabel(status),
        };
      }),
    placeholder: "Change status to…",
    title: key,
  };
  const priorityPage: SearchPage = {
    items: () => [
      {
        context: card.priority === undefined ? NOW : undefined,
        icon: <PriorityNoneIcon className={ICON} />,
        key: "priority:none",
        run: () => updateCard(board, card, { priority: undefined }),
        title: "No priority",
      },
      ...PRIORITIES.map(({ id, label }) => {
        const { icon: Icon, className } = PRIORITY_STYLES[id];
        return {
          context: id === card.priority ? NOW : undefined,
          icon: <Icon className={cn("size-4", className)} />,
          key: `priority:${id}`,
          run: () => updateCard(board, card, { priority: id }),
          title: label,
        };
      }),
    ],
    placeholder: "Set priority to…",
    title: key,
  };
  const peoplePage: SearchPage = {
    items: () =>
      people.map((person) => ({
        context: card.assignees.includes(person) ? "Assigned" : undefined,
        icon: <UserAvatar aria-hidden pubkey={person} size="xs" />,
        key: `person:${person}`,
        run: () => toggle(person),
        title: names.get(person) ?? "Someone",
      })),
    placeholder: "Assign to…",
    title: key,
  };

  const edits: SearchItem[] = [
    {
      icon: <CircleDashedIcon className={ICON} />,
      key: "cmd:status",
      keys: SHORTCUTS["card.status"],
      keywords: "move state",
      page: statusPage,
      title: "Change status…",
    },
    {
      icon: <ChartNoAxesColumnIcon className={ICON} />,
      key: "cmd:priority",
      keys: SHORTCUTS["card.priority"],
      keywords: "urgent important",
      page: priorityPage,
      title: "Set priority…",
    },
    {
      icon: <UserRoundIcon className={ICON} />,
      key: "cmd:assign",
      keys: SHORTCUTS["card.assign"],
      keywords: "people owner assignee",
      page: peoplePage,
      title: "Assign…",
    },
    {
      icon: <UserAvatar aria-hidden pubkey={pubkey} size="xs" />,
      key: "cmd:mine",
      keywords: "assign me self",
      run: () => toggle(pubkey),
      title: mine ? "Unassign me" : "Assign to me",
    },
    ...MARK_AS.map(({ label, relation, shortcut }) => {
      const { icon: Icon, className } = RELATION_STYLES[relation];
      return {
        icon: <Icon className={cn("size-4", className)} />,
        key: `cmd:mark:${relation}`,
        keys: shortcut,
        keywords: "relation link",
        run: () => onMark(relation),
        title: `Mark as ${label.toLowerCase()}…`,
      };
    }),
  ];
  const always: SearchItem[] = [
    {
      icon: <CopyIcon className={ICON} />,
      key: "cmd:copy-id",
      keywords: "key",
      run: () => copyAndTell(key, `Copied ${key}`),
      title: "Copy ID",
    },
    {
      icon: <LinkIcon className={ICON} />,
      key: "cmd:copy-link",
      keywords: "url share",
      run: () =>
        copyAndTell(
          // A shared link outlives today's board: another card may get this number later.
          new URL(
            cardPath(board, card, { query: boardQuery, withId: true }),
            window.location.origin
          ).href,
          "Link copied"
        ),
      title: "Copy link",
    },
  ];
  const remove: SearchItem = {
    icon: <Trash2Icon className="text-destructive size-4" />,
    key: "cmd:delete",
    keywords: "remove",
    run: onDelete,
    title: "Delete card…",
  };

  usePageCommands(key, canEdit ? [...edits, ...always, remove] : always);
  useShortcuts([
    {
      enabled: canEdit,
      keys: SHORTCUTS["card.status"],
      run: () => openPalette(statusPage),
    },
    {
      enabled: canEdit,
      keys: SHORTCUTS["card.priority"],
      run: () => openPalette(priorityPage),
    },
    {
      enabled: canEdit,
      keys: SHORTCUTS["card.assign"],
      run: () => openPalette(peoplePage),
    },
  ]);
}
