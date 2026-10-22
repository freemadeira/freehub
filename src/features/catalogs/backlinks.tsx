import { getTagValue } from "applesauce-core/helpers/event";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";
import { cn } from "cn";
import type { ReactNode } from "react";
import { Link } from "wouter";

import { appTarget, usePlaces } from "@/components/app-link";
import { boardQuery } from "@/features/board/board-context";
import { STATUS_STYLES } from "@/features/card/card-fields";
import { linkPath } from "@/features/catalogs/catalogs-context";
import { PlatformIcon } from "@/features/catalogs/platform-icon";
import { pagePath } from "@/features/docs/docs-context";
import { PageIcon } from "@/features/docs/page-icon";
import { fileHref } from "@/features/drive/drive-context";
import { FileIcon } from "@/features/drive/file-icon";
import { useBoardContents } from "@/hooks/use-board-contents";
import { commentedLink } from "@/hooks/use-catalogs";
import { useCommentsOn } from "@/hooks/use-comments";
import { useDriveContents } from "@/hooks/use-drive";
import { hasBlossom } from "@/lib/blossom";
import type { CatalogsContent, Link as SavedLink } from "@/lib/catalogs";
import type { DocsContent } from "@/lib/docs";
import { pageTitle } from "@/lib/docs";
import type { DriveContent } from "@/lib/drive";
import { splitLinks } from "@/lib/links";
import type { Board, BoardContent, Card, Comment } from "@/lib/model";
import {
  CARD_KIND,
  cardKey,
  DRIVE_FILE_KIND,
  LINK_KIND,
  needsCardId,
} from "@/lib/model";
import { cardPath } from "@/lib/paths";
import type { Project } from "@/lib/project";

const ICON = "size-4 shrink-0";

/** Where the link was referenced: the card, page, file or link whose text names it. */
interface Place {
  key: string;
  title: string;
  /** What kind of place it is, and where. */
  context: string;
  icon: ReactNode;
  href: string;
  /** When that text was written, in seconds. */
  at: number;
}

/** Whether the text names the link by any address the app gives it. */
function names(text: string, link: SavedLink): boolean {
  return splitLinks(text).some((part) => {
    if (part.type !== "link") {
      return false;
    }
    const target = appTarget(part.url);
    return target?.type === "link" && target.link === link.id;
  });
}

/** The id of the thing a comment on the given kind is on. */
function commentedOn(comment: Comment, kind: number): string | undefined {
  const root = parseReplaceableAddress(getTagValue(comment.event, "A") ?? "");
  return root?.kind === kind ? root.identifier : undefined;
}

interface CardAt {
  board: Board;
  content: BoardContent;
  card: Card;
}

function cardPlace(
  { board, content, card }: CardAt,
  boards: Board[],
  via: "description" | "comment",
  at: number
): Place {
  const { icon: Icon, className } = STATUS_STYLES[card.status];
  const key = cardKey(board, card);
  return {
    at,
    context:
      via === "comment" ? `Comment on ${key}` : `${key} · ${board.title}`,
    href: cardPath(board, card, {
      query: boardQuery(board, boards),
      withId: needsCardId(content, card),
    }),
    icon: <Icon className={cn(ICON, className)} />,
    key: `card:${board.address}/${card.id}`,
    title: card.title || "Untitled",
  };
}

/** Cards whose description, or a comment on them, names the link. */
function cardPlaces(
  link: SavedLink,
  boards: Board[],
  cards: Map<string, BoardContent> | undefined,
  comments: Comment[]
): Place[] {
  const places: Place[] = [];
  const onCards = new Map<string, CardAt[]>();
  for (const board of boards) {
    const content = cards?.get(board.address);
    if (!content) {
      continue;
    }
    for (const card of content.cards) {
      const at: CardAt = { board, card, content };
      onCards.set(card.id, [...(onCards.get(card.id) ?? []), at]);
      if (names(card.description, link)) {
        places.push(
          cardPlace(at, boards, "description", card.event.created_at)
        );
      }
    }
  }
  for (const comment of comments) {
    const id = commentedOn(comment, CARD_KIND);
    // Only comments by the board's members count, as on the card itself.
    const at = (id ? onCards.get(id) : undefined)?.find(({ board }) =>
      board.members.includes(comment.author)
    );
    if (at && names(comment.content, link)) {
      places.push(cardPlace(at, boards, "comment", comment.createdAt));
    }
  }
  return places;
}

/** Doc pages that name the link. */
function pagePlaces(
  link: SavedLink,
  projects: Project[],
  docs: Map<string, DocsContent>
): Place[] {
  return projects.flatMap((project) =>
    (docs.get(project.address)?.pages ?? []).flatMap((page) =>
      names(page.content, link)
        ? [
            {
              at: page.updatedAt,
              context: "Page",
              href: pagePath(project, page),
              icon: <PageIcon className={ICON} page={page} />,
              key: `doc:${project.address}/${page.id}`,
              title: pageTitle(page),
            },
          ]
        : []
    )
  );
}

/** Drive files a comment on which names the link. */
function filePlaces(
  link: SavedLink,
  projects: Project[],
  files: Map<string, DriveContent>,
  comments: Comment[]
): Place[] {
  return comments.flatMap((comment) => {
    const id = commentedOn(comment, DRIVE_FILE_KIND) ?? "";
    const project = projects.find(
      (item) =>
        item.members.includes(comment.author) &&
        files.get(item.address)?.fileById.has(id)
    );
    const content = project && files.get(project.address);
    const file = content?.fileById.get(id);
    if (!(project && file && names(comment.content, link))) {
      return [];
    }
    const folder = file.folder
      ? content?.tree.byId.get(file.folder)
      : undefined;
    return [
      {
        at: comment.createdAt,
        context: `Comment · ${folder?.name ?? "Drive"}`,
        href: fileHref(project, file, folder),
        icon: <FileIcon file={file} size="sm" />,
        key: `file:${project.address}/${file.id}`,
        title: file.name,
      },
    ];
  });
}

/** Other links a comment on which names the link. */
function linkPlaces(
  link: SavedLink,
  projects: Project[],
  catalogs: Map<string, CatalogsContent>,
  comments: Comment[]
): Place[] {
  return comments.flatMap((comment) => {
    const id = commentedLink(comment)?.id ?? link.id;
    const project = projects.find(
      (item) =>
        id !== link.id &&
        item.members.includes(comment.author) &&
        catalogs.get(item.address)?.linkById.has(id)
    );
    const content = project && catalogs.get(project.address);
    const other = content?.linkById.get(id);
    const catalog = other && content?.byId.get(other.catalog);
    if (!(project && other && catalog && names(comment.content, link))) {
      return [];
    }
    return [
      {
        at: comment.createdAt,
        context: `Comment · ${catalog.title}`,
        href: linkPath(project, catalog, other.id),
        icon: <PlatformIcon className={ICON} platform={other.platform} />,
        key: `link:${project.address}/${other.id}`,
        title: other.title,
      },
    ];
  });
}

/**
 * Where the link has been referenced, newest first: in a card's description
 * or comments, a doc page, or a comment on a file or another link, each
 * place once.
 */
function useBacklinks(link: SavedLink): Place[] {
  const { boards, projects, docs, catalogs } = usePlaces();
  const members = projects.flatMap((project) => project.members);
  const { contents: cards } = useBoardContents(boards);
  const { comments: cardComments } = useCommentsOn(
    CARD_KIND,
    boards.flatMap((board) => board.members)
  );
  const { comments: linkComments } = useCommentsOn(LINK_KIND, members);
  const drive = hasBlossom();
  const { contents: files } = useDriveContents(drive ? projects : []);
  const { comments: fileComments } = useCommentsOn(
    DRIVE_FILE_KIND,
    drive ? members : []
  );
  const seen = new Set<string>();
  return [
    ...cardPlaces(link, boards, cards, cardComments),
    ...pagePlaces(link, projects, docs),
    ...filePlaces(link, projects, files, fileComments),
    ...linkPlaces(link, projects, catalogs, linkComments),
  ]
    .toSorted((a, b) => b.at - a.at)
    .filter((place) => {
      const fresh = !seen.has(place.key);
      seen.add(place.key);
      return fresh;
    });
}

/**
 * Where the link was referenced, newest first: each card, page, file or
 * link once, opening it. Nothing while it hasn't been.
 */
export function Backlinks({
  link,
  className,
}: {
  link: SavedLink;
  className?: string;
}) {
  const places = useBacklinks(link);
  if (places.length === 0) {
    return null;
  }
  return (
    <section
      aria-label="Mentioned in"
      className={cn("flex flex-col gap-1", className)}
    >
      <h3 className="text-sm font-semibold">Mentioned in</h3>
      <ul className="-mx-2 flex flex-col">
        {places.map((place) => (
          <li key={place.key}>
            <Link
              className="hover:bg-foreground/5 focus-visible:ring-ring/50 flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-sm transition-colors duration-150 outline-none focus-visible:ring-3"
              href={place.href}
            >
              <span aria-hidden className="flex shrink-0 items-center">
                {place.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{place.title}</span>
              <span className="text-muted-foreground max-w-[45%] shrink-0 truncate text-xs">
                {place.context}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
