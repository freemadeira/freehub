import { PreviewCard } from "@base-ui/react/preview-card";
import { cn } from "cn";
import { BookmarkIcon, SquareKanbanIcon } from "lucide-react";
import type { ReactNode } from "react";
import { createContext, use } from "react";
import { Link } from "wouter";

import { ProjectAvatar } from "@/components/project-avatar";
import { BLOG_SEGMENT } from "@/features/blog/blog-context";
import {
  BoardContext,
  findBoard,
  parseSlug,
} from "@/features/board/board-context";
import { STATUS_STYLES } from "@/features/card/card-fields";
import {
  CATALOGS_SEGMENT,
  LINK_PARAM,
  parseCatalogParam,
} from "@/features/catalogs/catalogs-context";
import { useLinkPicture } from "@/features/catalogs/link-picture";
import { PlatformIcon } from "@/features/catalogs/platform-icon";
import { CrmContext } from "@/features/crm/crm-context";
import { TableIcon } from "@/features/crm/table-icon";
import { DOCS_SEGMENT, parsePageParam } from "@/features/docs/docs-context";
import { PageIcon } from "@/features/docs/page-icon";
import { DRIVE_SEGMENT, FILE_PARAM } from "@/features/drive/drive-context";
import { FileIcon } from "@/features/drive/file-icon";
import { useBoardContent } from "@/hooks/use-board-content";
import { useDriveContent } from "@/hooks/use-drive";
import { useProjectContent } from "@/hooks/use-project-content";
import type { CatalogsContent, Link as SavedLink } from "@/lib/catalogs";
import { hostOf } from "@/lib/catalogs";
import type { CrmTable, ProjectContent } from "@/lib/crm";
import { recordTitle } from "@/lib/crm";
import type { DocsContent } from "@/lib/docs";
import { pageTitle } from "@/lib/docs";
import type { DriveFile, DriveTree } from "@/lib/drive";
import { thumbSource, useOpened } from "@/lib/drive-files";
import type { Board, BoardContent } from "@/lib/model";
import { cardKey, RESERVED_CODES, statusLabel } from "@/lib/model";
import type { Project } from "@/lib/project";

/** What links to the app are named after: everything the user sees. */
export interface Places {
  boards: Board[];
  projects: Project[];
  /** Every project's tables, by project address. */
  tables: Map<string, CrmTable[]>;
  /** Every project's pages, by project address. */
  docs: Map<string, DocsContent>;
  /** Every project's Drive folders, by project address; none when the team keeps no files. */
  drive?: Map<string, DriveTree>;
  /** Every project's catalogs and their links, by project address. */
  catalogs: Map<string, CatalogsContent>;
}

export const PlacesContext = createContext<Places | null>(null);

const NO_PLACES: Places = {
  boards: [],
  catalogs: new Map(),
  docs: new Map(),
  projects: [],
  tables: new Map(),
};

/** Something in the app a link goes to, as its address names it. */
export type AppTarget =
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
  | { type: "record"; project: string; table: string; record: string }
  | { type: "catalog"; project: string; catalog: string }
  | { type: "link"; project: string; catalog: string; link: string }
  | { type: "file"; project: string; file: string };

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

/** A catalog, or a link opened over it, by its address. */
function catalogTarget(
  project: string,
  param: string | undefined,
  query: URLSearchParams
): AppTarget | undefined {
  const catalog = param ? parseCatalogParam(param) : undefined;
  if (!catalog) {
    return undefined;
  }
  const link = query.get(LINK_PARAM);
  return link
    ? { catalog, link, project, type: "link" }
    : { catalog, project, type: "catalog" };
}

/**
 * What a full address names, read as the app's routes read it, if it's one of
 * the app's own: a board, card, project, doc page, table, record, catalog,
 * catalog link or Drive file.
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
  if (table === CATALOGS_SEGMENT) {
    return catalogTarget(project, record, url.searchParams);
  }
  if (table === DRIVE_SEGMENT) {
    const file = url.searchParams.get(FILE_PARAM);
    return file ? { file, project, type: "file" } : undefined;
  }
  // The blog isn't a table; its links show as written.
  if (table === BLOG_SEGMENT) {
    return undefined;
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

/** What hovering a badge shows besides its title: where it is, and more for some. */
interface Preview {
  /** Where it sits, like a card's key and board. */
  context: string;
  /** A picture of it, fetched once the preview opens. */
  picture?: ReactNode;
  /** A link's summary. */
  summary?: string;
  /** A link's site. */
  site?: string;
}

/** What hovering a badge shows: its picture, where it is, its title, and a link's summary and site. */
function PreviewBody({
  icon,
  title,
  preview,
}: {
  icon: ReactNode;
  title: string;
  preview: Preview;
}) {
  return (
    <>
      {preview.picture}
      <div className="flex flex-col gap-1 p-3">
        <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
          <span
            aria-hidden
            className="inline-flex size-[1.1em] shrink-0 items-center justify-center *:size-full"
          >
            {icon}
          </span>
          <span className="truncate">{preview.context}</span>
        </p>
        <p className="line-clamp-3 font-medium wrap-break-word">{title}</p>
        {preview.summary && (
          <p className="text-muted-foreground line-clamp-2 text-xs">
            {preview.summary}
          </p>
        )}
        {preview.site && (
          <p className="text-muted-foreground truncate text-xs">
            {preview.site}
          </p>
        )}
      </div>
    </>
  );
}

/** A place in the app, by its icon and name; hovering it previews it. */
function Badge({
  href,
  interactive,
  icon,
  title,
  preview,
}: LinkProps & { icon: ReactNode; title: string; preview?: Preview }) {
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
  if (!interactive) {
    return <span className={BADGE}>{content}</span>;
  }
  const className = cn(
    BADGE,
    "hover:bg-foreground/10 focus-visible:ring-ring/50 transition-colors duration-150 outline-none focus-visible:ring-3"
  );
  const path = appPath(href) ?? href;
  if (!preview) {
    return (
      <Link className={className} href={path}>
        {content}
      </Link>
    );
  }
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        className={className}
        delay={400}
        render={<Link href={path} />}
      >
        {content}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner
          align="start"
          className="isolate z-50"
          side="top"
          sideOffset={6}
        >
          <PreviewCard.Popup className="bg-popover text-popover-foreground shadow-raised w-72 origin-(--transform-origin) overflow-hidden rounded-xl text-sm transition-[opacity,scale] duration-150 ease-out outline-none data-ending-style:scale-[0.96] data-ending-style:opacity-0 data-ending-style:duration-100 data-starting-style:scale-[0.96] data-starting-style:opacity-0">
            <PreviewBody icon={icon} preview={preview} title={title} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}

type TargetProps<Type extends AppTarget["type"]> = LinkProps & {
  target: Extract<AppTarget, { type: Type }>;
};

export function usePlaces(): Places {
  return use(PlacesContext) ?? NO_PLACES;
}

function findProject(places: Places, slug: string): Project | undefined {
  return places.projects.find((project) => project.slug === slug.toLowerCase());
}

function CardBadge({
  board,
  content,
  target,
  ...props
}: TargetProps<"card"> & { board: Board; content: BoardContent | undefined }) {
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
      preview={{
        context: `${cardKey(board, card)} · ${statusLabel(card.status)} · ${board.title}`,
      }}
      title={card.title}
    />
  );
}

function OtherBoardCardBadge({
  board,
  ...props
}: TargetProps<"card"> & { board: Board }) {
  const { content } = useBoardContent(board);
  return <CardBadge {...props} board={board} content={content} />;
}

function BoardLink({ target, ...props }: TargetProps<"board" | "card">) {
  const scope = use(BoardContext);
  const board = findBoard(usePlaces().boards, target.code, target.board);
  if (!board) {
    return <PlainLink {...props} />;
  }
  if (target.type === "board") {
    return (
      <Badge
        {...props}
        icon={<SquareKanbanIcon />}
        preview={{ context: `${board.code} · Board` }}
        title={board.title}
      />
    );
  }
  // Cards of the board on screen are already at hand.
  return scope?.board.address === board.address ? (
    <CardBadge
      {...props}
      board={board}
      content={scope.content}
      target={target}
    />
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
  return project && page ? (
    <Badge
      {...props}
      icon={<PageIcon page={page} />}
      preview={{ context: `Docs · ${project.title}` }}
      title={pageTitle(page)}
    />
  ) : (
    <PlainLink {...props} />
  );
}

function RecordBadge({
  content,
  project,
  table,
  target,
  ...props
}: TargetProps<"record"> & {
  content: ProjectContent | undefined;
  project: Project;
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
      preview={{ context: `${table.title} · ${project.title}` }}
      title={recordTitle(record)}
    />
  );
}

function OtherProjectRecordBadge({
  project,
  ...props
}: TargetProps<"record"> & { project: Project; table: CrmTable }) {
  const { content } = useProjectContent(project);
  return <RecordBadge {...props} content={content} project={project} />;
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
        preview={{ context: `Table · ${project.title}` }}
        title={table.title}
      />
    );
  }
  // Records of the project on screen are already at hand.
  return crm?.project.address === project.address ? (
    <RecordBadge
      {...props}
      content={crm.content}
      project={project}
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

/** A link's picture, as large as a preview's width. */
function LinkPicture({ link }: { link: SavedLink }) {
  const src = useLinkPicture(link);
  return src ? (
    <img
      alt=""
      className="bg-foreground/5 aspect-[1.91] w-full object-cover"
      draggable={false}
      referrerPolicy="no-referrer"
      src={src}
    />
  ) : null;
}

function CatalogLink({ target, ...props }: TargetProps<"catalog" | "link">) {
  const places = usePlaces();
  const project = findProject(places, target.project);
  const content = project ? places.catalogs.get(project.address) : undefined;
  const catalog = content?.byId.get(target.catalog);
  if (!(project && catalog)) {
    return <PlainLink {...props} />;
  }
  if (target.type === "catalog") {
    return (
      <Badge
        {...props}
        icon={<BookmarkIcon />}
        preview={{ context: `Catalog · ${project.title}` }}
        title={catalog.title}
      />
    );
  }
  const link = content?.linkById.get(target.link);
  if (!link) {
    return <PlainLink {...props} />;
  }
  return (
    <Badge
      {...props}
      icon={<PlatformIcon platform={link.platform} />}
      preview={{
        context: `${catalog.title} · ${project.title}`,
        picture: <LinkPicture link={link} />,
        site: hostOf(link.url),
        summary: link.summary,
      }}
      title={link.title}
    />
  );
}

/** A Drive file's thumbnail, as large as a preview's width. */
function FilePicture({ file }: { file: DriveFile }) {
  const { url } = useOpened(thumbSource(file));
  return url ? (
    <img
      alt=""
      className="bg-foreground/5 aspect-[1.91] w-full object-cover"
      draggable={false}
      src={url}
    />
  ) : null;
}

function FileBadge({
  project,
  target,
  ...props
}: TargetProps<"file"> & { project: Project }) {
  const { content } = useDriveContent(project);
  const file = content.fileById.get(target.file);
  if (!file) {
    return <PlainLink {...props} />;
  }
  const folder = file.folder ? content.tree.byId.get(file.folder) : undefined;
  return (
    <Badge
      {...props}
      icon={<FileIcon file={file} size="sm" />}
      preview={{
        context: `${folder?.name ?? "Drive"} · ${project.title}`,
        picture: file.thumb ? <FilePicture file={file} /> : undefined,
      }}
      title={file.name}
    />
  );
}

function FileLink({ target, ...props }: TargetProps<"file">) {
  const places = usePlaces();
  const project = findProject(places, target.project);
  // Only teams with somewhere to keep files have a Drive.
  return project && places.drive ? (
    <FileBadge {...props} project={project} target={target} />
  ) : (
    <PlainLink {...props} />
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
    case "catalog":
    case "link": {
      return <CatalogLink {...props} target={target} />;
    }
    case "file": {
      return <FileLink {...props} target={target} />;
    }
    default: {
      return <PlainLink {...props} />;
    }
  }
}
