import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";
import { cn } from "cn";
import { MessageSquareTextIcon } from "lucide-react";
import { useMemo } from "react";

import type { Places } from "@/components/app-link";
import { usePlaces } from "@/components/app-link";
import { boardQuery } from "@/features/board/board-context";
import { STATUS_STYLES } from "@/features/card/card-fields";
import { TableIcon } from "@/features/crm/table-icon";
import { pagePath } from "@/features/docs/docs-context";
import { PageIcon } from "@/features/docs/page-icon";
import { fileHref } from "@/features/drive/drive-context";
import { FileIcon } from "@/features/drive/file-icon";
import { ICON } from "@/features/search/items";
import type { SearchItem } from "@/features/search/search-item";
import { useBoardContents } from "@/hooks/use-board-contents";
import { useCardComments } from "@/hooks/use-comments";
import { useCrmContents } from "@/hooks/use-crm-contents";
import { useDriveContents } from "@/hooks/use-drive";
import { useProfileNames } from "@/hooks/use-profile-names";
import { hasBlossom } from "@/lib/blossom";
import type { ProjectContent } from "@/lib/crm";
import { recordTitle } from "@/lib/crm";
import { plainValue } from "@/lib/crm-values";
import { pageTitle } from "@/lib/docs";
import type { DriveContent } from "@/lib/drive";
import type { Board, BoardContent, Card, Comment } from "@/lib/model";
import { cardKey, needsCardId } from "@/lib/model";
import { cardPath, recordPath } from "@/lib/paths";
import type { Project } from "@/lib/project";
import { inProject } from "@/lib/project";
import type { SearchKind } from "@/lib/search";
import {
  CARD_KEY,
  plainText,
  searchable,
  searchableScore,
  snippet,
} from "@/lib/search";

/** How many of each kind a search of everything finds; one kind on its own finds more. */
const FEW = 8;
const MANY = 40;

/** Something found by what's in it: the item to open, and its words. */
interface Entry {
  item: SearchItem;
  /** The title, made `searchable`; empty where only the text counts. */
  title: string;
  /** What's inside, as plain text, for snippets. */
  text: string;
  /** What's inside, made `searchable`. */
  words: string;
  /** When it last changed, which breaks ties. */
  at: number;
  /** Who wrote it, for comments, which say so. */
  author?: string;
}

/** What search looks through, by kind, and every item by its key. */
export interface SearchIndex {
  entries: Record<SearchKind, Entry[]>;
  /** Cards by their key, like `FREE-12`. */
  byCardKey: Map<string, Entry[]>;
  byKey: Map<string, SearchItem>;
}

export type Found = Record<SearchKind, SearchItem[]>;

// Text is made ready once per version, since a version never changes.
const prepared = new WeakMap<NostrEvent, { text: string; words: string }>();

function prepare(event: NostrEvent, raw: string) {
  let ready = prepared.get(event);
  if (!ready) {
    const text = plainText(raw);
    ready = { text, words: searchable(text) };
    prepared.set(event, ready);
  }
  return ready;
}

function statusIcon(card: Card) {
  const status = STATUS_STYLES[card.status];
  return <status.icon aria-hidden className={cn(ICON, status.className)} />;
}

interface CardPlace {
  board: Board;
  content: BoardContent;
  card: Card;
  project?: Project;
}

function cardItem(
  { board, content, card, project }: CardPlace,
  boards: Board[]
): SearchItem {
  return {
    context: `${cardKey(board, card)} · ${board.title}`,
    href: cardPath(board, card, {
      query: boardQuery(board, boards),
      withId: needsCardId(content, card),
    }),
    icon: statusIcon(card),
    key: `card:${board.address}/${card.id}`,
    project: project?.address,
    title: card.title || "Untitled",
  };
}

function cardPlaces(
  { boards, projects }: Places,
  contents: Map<string, BoardContent> | undefined
): CardPlace[] {
  return boards.flatMap((board) => {
    const content = contents?.get(board.address);
    if (!content) {
      return [];
    }
    const project = projects.find((each) => inProject(board, each));
    return content.cards.map((card) => ({
      board,
      card,
      content,
      project,
    }));
  });
}

function cardEntries(places: CardPlace[], boards: Board[]): Entry[] {
  return places.map((place) => ({
    at: place.card.event.created_at,
    item: cardItem(place, boards),
    title: searchable(place.card.title),
    ...prepare(place.card.event, place.card.description),
  }));
}

function docEntries({ docs, projects }: Places): Entry[] {
  return projects.flatMap((project) =>
    (docs.get(project.address)?.pages ?? []).map((page) => ({
      at: page.updatedAt,
      item: {
        context: project.title,
        href: pagePath(project, page),
        icon: <PageIcon className="text-muted-foreground" page={page} />,
        key: `doc:${project.address}/${page.id}`,
        project: project.address,
        title: pageTitle(page),
      },
      title: searchable(page.title),
      ...prepare(page.event, page.content),
    }))
  );
}

function recordEntries(
  projects: Project[],
  contents: Map<string, ProjectContent>
): Entry[] {
  return projects.flatMap((project) => {
    const content = contents.get(project.address);
    if (!content) {
      return [];
    }
    const titleOf = (id: string) => {
      const related = content.byId.get(id);
      return related ? recordTitle(related) : undefined;
    };
    return content.tables.flatMap((table) => {
      // Pubkeys read as noise; the title shows already.
      const fields = table.fields.filter(
        (field) => field.type !== "title" && field.type !== "member"
      );
      return (content.byTable.get(table.id) ?? []).map((record) => {
        const text = fields
          .map((field) => plainValue(field, record, titleOf))
          .filter(Boolean)
          .join(" · ");
        return {
          at: record.updatedAt,
          item: {
            context: `${table.title} · ${project.title}`,
            href: recordPath(project, table, record),
            icon: <TableIcon className={ICON} icon={table.icon} />,
            key: `record:${project.address}/${record.id}`,
            project: project.address,
            title: recordTitle(record),
          },
          text,
          title: searchable(record.title),
          words: searchable(text),
        };
      });
    });
  });
}

function fileEntries(
  projects: Project[],
  contents: Map<string, DriveContent>
): Entry[] {
  return projects.flatMap((project) => {
    const content = contents.get(project.address);
    return (content?.files ?? []).map((file) => {
      const folder = file.folder
        ? content?.tree.byId.get(file.folder)
        : undefined;
      return {
        at: file.updatedAt,
        item: {
          context: `${folder?.name ?? "Drive"} · ${project.title}`,
          href: fileHref(project, file, folder),
          icon: <FileIcon file={file} size="sm" />,
          key: `file:${project.address}/${file.id}`,
          project: project.address,
          title: file.name,
        },
        text: "",
        title: searchable(file.name),
        words: "",
      };
    });
  });
}

/** Comments name their card by address; these find it on the boards it's on. */
function commentEntries(
  comments: Comment[],
  places: CardPlace[],
  boards: Board[]
): Entry[] {
  const byId = new Map<string, CardPlace[]>();
  for (const place of places) {
    byId.set(place.card.id, [...(byId.get(place.card.id) ?? []), place]);
  }
  return comments.flatMap((comment) => {
    const [, pubkey, id = ""] =
      getTagValue(comment.event, "A")?.split(":") ?? [];
    // Only comments by the board's members count, as on the card itself.
    const place = byId
      .get(id)
      ?.find(
        ({ board }) =>
          pubkey !== undefined &&
          board.members.includes(pubkey) &&
          board.members.includes(comment.author)
      );
    if (!place) {
      return [];
    }
    return [
      {
        at: comment.createdAt,
        author: comment.author,
        item: {
          ...cardItem(place, boards),
          context: cardKey(place.board, place.card),
          icon: <MessageSquareTextIcon className={ICON} />,
          key: `comment:${comment.id}`,
        },
        title: "",
        ...prepare(comment.event, comment.content),
      },
    ];
  });
}

/**
 * Everything search looks through, from what the team relays hold: every
 * card, doc page, CRM record, Drive file and card comment the user can see.
 * Comments and files load only once something searches.
 */
export function useSearchIndex(): { index: SearchIndex; loading: boolean } {
  const places = usePlaces();
  const { boards, projects } = places;
  const { contents: cards, loaded: cardsLoaded } = useBoardContents(boards);
  const { contents: crm, loaded: crmLoaded } = useCrmContents(projects);
  const { contents: drive, loaded: driveLoaded } = useDriveContents(
    hasBlossom() ? projects : []
  );
  const { comments, loaded: commentsLoaded } = useCardComments(boards);
  const index = useMemo((): SearchIndex => {
    const onCards = cardPlaces(places, cards);
    const entries: Record<SearchKind, Entry[]> = {
      card: cardEntries(onCards, boards),
      comment: commentEntries(comments, onCards, boards),
      doc: docEntries(places),
      file: fileEntries(projects, drive),
      record: recordEntries(projects, crm),
    };
    const byCardKey = new Map<string, Entry[]>();
    for (const [offset, entry] of entries.card.entries()) {
      const place = onCards[offset];
      if (place?.card.number !== undefined) {
        const key = cardKey(place.board, place.card);
        byCardKey.set(key, [...(byCardKey.get(key) ?? []), entry]);
      }
    }
    const byKey = new Map(
      Object.values(entries)
        .flat()
        .map((entry) => [entry.item.key, entry.item])
    );
    return { byCardKey, byKey, entries };
  }, [places, boards, projects, cards, crm, drive, comments]);
  return {
    index,
    loading: !(cardsLoaded && crmLoaded && driveLoaded && commentsLoaded),
  };
}

/** Better matches first: the title's, then the text's; newer first otherwise. */
function find(
  entries: Entry[],
  terms: string[],
  { limit, project }: { limit: number; project?: string }
): Entry[] {
  return entries
    .flatMap((entry) => {
      if (project && entry.item.project !== project) {
        return [];
      }
      const byTitle = searchableScore(entry.title, terms);
      if (byTitle > 0) {
        return [{ entry, score: byTitle }];
      }
      const inside = terms.every(
        (term) =>
          entry.title.includes(` ${term}`) || entry.words.includes(` ${term}`)
      );
      return inside ? [{ entry, score: 0 }] : [];
    })
    .toSorted((a, b) => b.score - a.score || b.entry.at - a.entry.at)
    .slice(0, limit)
    .map(({ entry, score }) =>
      score > 0 || !entry.text
        ? entry
        : {
            ...entry,
            item: { ...entry.item, snippet: snippet(entry.text, terms) },
          }
    );
}

/**
 * What the words find, by kind, in what the index holds. A card's key typed
 * on its own, like `FREE-12`, finds that card first.
 */
export function useFound(
  index: SearchIndex,
  terms: string[],
  typed: string,
  { kind, project }: { kind?: SearchKind; project?: string } = {}
): Found {
  const names = useProfileNames([
    ...new Set(index.entries.comment.flatMap((entry) => entry.author ?? [])),
  ]);
  const limit = kind ? MANY : FEW;
  const wants = (each: SearchKind) =>
    terms.length > 0 && (kind === undefined || kind === each);
  const look = (each: SearchKind) =>
    wants(each) ? find(index.entries[each], terms, { limit, project }) : [];

  const keyed = CARD_KEY.test(typed.trim())
    ? (index.byCardKey.get(typed.trim().toUpperCase()) ?? []).filter(
        (entry) => !project || entry.item.project === project
      )
    : [];
  const keys = new Set(keyed.map((entry) => entry.item.key));
  const cards = wants("card")
    ? [
        ...keyed,
        ...look("card").filter((entry) => !keys.has(entry.item.key)),
      ].slice(0, limit)
    : [];
  return {
    card: cards.map((entry) => entry.item),
    comment: look("comment").map((entry) => ({
      ...entry.item,
      context: `${names.get(entry.author ?? "") ?? "Someone"} on ${entry.item.context}`,
    })),
    doc: look("doc").map((entry) => entry.item),
    file: look("file").map((entry) => entry.item),
    record: look("record").map((entry) => entry.item),
  };
}
