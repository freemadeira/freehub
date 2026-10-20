import { cn } from "cn";
import { SquareKanbanIcon } from "lucide-react";
import type { ReactNode } from "react";
import { createContext, use } from "react";
import { Link } from "wouter";

import { ProjectAvatar } from "@/components/project-avatar";
import {
  BoardContext,
  findBoard,
  parseSlug,
} from "@/features/board/board-context";
import { STATUS_STYLES } from "@/features/card/card-fields";
import { CrmContext } from "@/features/crm/crm-context";
import { TableIcon } from "@/features/crm/table-icon";
import { DOCS_SEGMENT, parsePageParam } from "@/features/docs/docs-context";
import { PageIcon } from "@/features/docs/page-icon";
import { useBoardContent } from "@/hooks/use-board-content";
import { useProjectContent } from "@/hooks/use-project-content";
import type { CrmTable, ProjectContent } from "@/lib/crm";
import { recordTitle } from "@/lib/crm";
import type { DocsContent } from "@/lib/docs";
import { pageTitle } from "@/lib/docs";
import type { Board, BoardContent } from "@/lib/model";
import { RESERVED_CODES } from "@/lib/model";
import type { Project } from "@/lib/project";

/** What links to the app are named after: everything the user sees. */
export interface Places {
  boards: Board[];
  projects: Project[];
  /** Every project's tables, by project address. */
  tables: Map<string, CrmTable[]>;
  /** Every project's pages, by project address. */
  docs: Map<string, DocsContent>;
}

export const PlacesContext = createContext<Places | null>(null);

const NO_PLACES: Places = {
  boards: [],
  docs: new Map(),
  projects: [],
  tables: new Map(),
};

/** Something in the app a link goes to, as its address names it. */
type AppTarget =
  | { type: "board"; code: string; board: string | null }
  | {
      type: "card";
      code: string;
      board: string | null;
      card: string | null;
      number?: number;
    }
  | { type: "project"; project: string }
  | { type: "page"; project: string; page: string }
  | { type: "table"; project: string; table: string }
  | { type: "record"; project: string; table: string; record: string };

function ownUrl(href: string): URL | undefined {
  const { origin } = globalThis.location;
  const url = URL.canParse(href, origin) ? new URL(href, origin) : undefined;
  return url?.origin === origin ? url : undefined;
}

/** The path within the app an address goes to, if it's one of the app's own. */
export function appPath(href: string): string | undefined {
  const url = ownUrl(href);
  return url ? `${url.pathname}${url.search}${url.hash}` : undefined;
}

function boardTarget(segment: string, query: URLSearchParams) {
  const slug = parseSlug(segment);
  if (!slug || RESERVED_CODES.has(slug.code)) {
    return;
  }
  const board = query.get("board");
  const card = query.get("card");
  return card === null && slug.number === undefined
    ? { board, code: slug.code, type: "board" as const }
    : {
        board,
        card,
        code: slug.code,
        number: slug.number,
        type: "card" as const,
      };
}

/**
 * What a full address names, read as the app's routes read it, if it's one of
 * the app's own: a board, card, project, doc page, table or record.
 */
export function appTarget(href: string): AppTarget | undefined {
  const url = ownUrl(href);
  if (!url) {
    return undefined;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 1 && segments[0]) {
    return boardTarget(segments[0], url.searchParams);
  }
  const [p, project, table, record, ...rest] = segments;
  if (p !== "p" || !project || rest.length > 0) {
    return undefined;
  }
  if (!table) {
    return { project, type: "project" };
  }
  if (table === DOCS_SEGMENT) {
    const page = record ? parsePageParam(record) : undefined;
    return page ? { page, project, type: "page" } : undefined;
  }
  return record
    ? { project, record, table, type: "record" }
    : { project, table, type: "table" };
}

const LINK =
  "font-medium underline decoration-current/30 underline-offset-3 transition-[text-decoration-color] duration-150 ease-out hover:decoration-current";
const BADGE =
  "bg-foreground/6 rounded-md px-1 py-px font-medium no-underline box-decoration-clone";

interface LinkProps {
  href: string;
  /** False inside another link: it shows as text, not a link of its own. */
  interactive: boolean;
}

/** An address as written, linked. */
function PlainLink({ href, interactive }: LinkProps) {
  const path = appPath(href);
  if (!interactive) {
    return href;
  }
  return path === undefined ? (
    <a className={LINK} href={href} rel="noopener noreferrer" target="_blank">
      {href}
    </a>
  ) : (
    <Link className={LINK} href={path}>
      {href}
    </Link>
  );
}

/** A place in the app, by its icon and name. */
function Badge({
  href,
  interactive,
  icon,
  title,
}: LinkProps & { icon: ReactNode; title: string }) {
  const content = (
    <>
      <span
        aria-hidden
        className="mr-1 inline-flex size-[1.1em] items-center justify-center align-[-0.2em] *:size-full"
      >
        {icon}
      </span>
      {title}
    </>
  );
  return interactive ? (
    <Link
      className={cn(
        BADGE,
        "hover:bg-foreground/10 focus-visible:ring-ring/50 transition-colors duration-150 outline-none focus-visible:ring-3"
      )}
      href={appPath(href) ?? href}
    >
      {content}
    </Link>
  ) : (
    <span className={BADGE}>{content}</span>
  );
}

type TargetProps<Type extends AppTarget["type"]> = LinkProps & {
  target: Extract<AppTarget, { type: Type }>;
};

function usePlaces(): Places {
  return use(PlacesContext) ?? NO_PLACES;
}

function findProject(places: Places, slug: string): Project | undefined {
  return places.projects.find((project) => project.slug === slug.toLowerCase());
}

function CardBadge({
  content,
  target,
  ...props
}: TargetProps<"card"> & { content: BoardContent | undefined }) {
  // The id wins: it tells apart cards that share a number.
  const card = content?.cards.find((item) =>
    target.card === null
      ? item.number === target.number
      : item.id === target.card
  );
  if (!card) {
    return <PlainLink {...props} />;
  }
  const { icon: Icon, className } = STATUS_STYLES[card.status];
  return (
    <Badge
      {...props}
      icon={<Icon className={className} />}
      title={card.title}
    />
  );
}

function OtherBoardCardBadge({
  board,
  ...props
}: TargetProps<"card"> & { board: Board }) {
  const { content } = useBoardContent(board);
  return <CardBadge {...props} content={content} />;
}

function BoardLink({ target, ...props }: TargetProps<"board" | "card">) {
  const scope = use(BoardContext);
  const board = findBoard(usePlaces().boards, target.code, target.board);
  if (!board) {
    return <PlainLink {...props} />;
  }
  if (target.type === "board") {
    return <Badge {...props} icon={<SquareKanbanIcon />} title={board.title} />;
  }
  // Cards of the board on screen are already at hand.
  return scope?.board.address === board.address ? (
    <CardBadge {...props} content={scope.content} target={target} />
  ) : (
    <OtherBoardCardBadge {...props} board={board} target={target} />
  );
}

function ProjectLink({ target, ...props }: TargetProps<"project">) {
  const project = findProject(usePlaces(), target.project);
  return project ? (
    <Badge
      {...props}
      icon={<ProjectAvatar className="text-[0.5em]" project={project} />}
      title={project.title}
    />
  ) : (
    <PlainLink {...props} />
  );
}

function PageLink({ target, ...props }: TargetProps<"page">) {
  const places = usePlaces();
  const project = findProject(places, target.project);
  const page = project
    ? places.docs.get(project.address)?.byId.get(target.page)
    : undefined;
  return page ? (
    <Badge {...props} icon={<PageIcon page={page} />} title={pageTitle(page)} />
  ) : (
    <PlainLink {...props} />
  );
}

function RecordBadge({
  content,
  table,
  target,
  ...props
}: TargetProps<"record"> & {
  content: ProjectContent | undefined;
  table: CrmTable;
}) {
  const record = content?.byId.get(target.record);
  if (record?.table !== table.id) {
    return <PlainLink {...props} />;
  }
  return (
    <Badge
      {...props}
      icon={<TableIcon icon={table.icon} />}
      title={recordTitle(record)}
    />
  );
}

function OtherProjectRecordBadge({
  project,
  ...props
}: TargetProps<"record"> & { project: Project; table: CrmTable }) {
  const { content } = useProjectContent(project);
  return <RecordBadge {...props} content={content} />;
}

function TableLink({ target, ...props }: TargetProps<"table" | "record">) {
  const places = usePlaces();
  const crm = use(CrmContext);
  const project = findProject(places, target.project);
  const table = project
    ? places.tables
        .get(project.address)
        ?.find((item) => item.slug === target.table.toLowerCase())
    : undefined;
  if (!(project && table)) {
    return <PlainLink {...props} />;
  }
  if (target.type === "table") {
    return (
      <Badge
        {...props}
        icon={<TableIcon icon={table.icon} />}
        title={table.title}
      />
    );
  }
  // Records of the project on screen are already at hand.
  return crm?.project.address === project.address ? (
    <RecordBadge
      {...props}
      content={crm.content}
      table={table}
      target={target}
    />
  ) : (
    <OtherProjectRecordBadge
      {...props}
      project={project}
      table={table}
      target={target}
    />
  );
}

/**
 * A link to somewhere in the app, shown as what it goes to: a card by its
 * status and title, a page by its icon and title, and so on. Any other
 * address, or one to something the user can't see, stays as written.
 */
export function AppLink({
  href,
  interactive = true,
}: Partial<LinkProps> & { href: string }) {
  const target = appTarget(href);
  const props = { href, interactive };
  switch (target?.type) {
    case "board":
    case "card": {
      return <BoardLink {...props} target={target} />;
    }
    case "project": {
      return <ProjectLink {...props} target={target} />;
    }
    case "page": {
      return <PageLink {...props} target={target} />;
    }
    case "table":
    case "record": {
      return <TableLink {...props} target={target} />;
    }
    default: {
      return <PlainLink {...props} />;
    }
  }
}
