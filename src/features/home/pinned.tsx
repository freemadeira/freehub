import { Combobox } from "@base-ui/react/combobox";
import { cn } from "cn";
import {
  BookmarkIcon,
  PinOffIcon,
  PlusIcon,
  SearchIcon,
  SquareKanbanIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

import { IconButton } from "@/components/icon-button";
import { Section } from "@/components/page-section";
import { ProjectAvatar } from "@/components/project-avatar";
import { FIELD } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { boardPath } from "@/features/board/board-context";
import { catalogPath } from "@/features/catalogs/catalogs-context";
import { TableIcon } from "@/features/crm/table-icon";
import { pagePath } from "@/features/docs/docs-context";
import { PageIcon } from "@/features/docs/page-icon";
import { useHome } from "@/features/home/home-context";
import type { CatalogsContent } from "@/lib/catalogs";
import type { CrmTable } from "@/lib/crm";
import type { DocsContent } from "@/lib/docs";
import { pageTitle } from "@/lib/docs";
import type { Pin } from "@/lib/home";
import { pinKey } from "@/lib/home";
import type { Board } from "@/lib/model";
import { tablePath } from "@/lib/paths";
import type { Project } from "@/lib/project";
import { inProject } from "@/lib/project";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const ICON = "text-muted-foreground size-4 shrink-0";

/** Something that can be pinned, as Home shows it. */
interface PinTarget {
  pin: Pin;
  key: string;
  kind: "Projects" | "Boards" | "Tables" | "Pages" | "Catalogs";
  title: string;
  /** The project it's in, if it isn't one. */
  place?: string;
  href: string;
  icon: ReactNode;
}

interface Places {
  projects: Project[];
  boards: Board[];
  /** Every project's tables, by project address. */
  tables: Map<string, CrmTable[]>;
  /** Every project's pages, by project address. */
  docs: Map<string, DocsContent>;
  /** Every project's catalogs, by project address. */
  catalogs: Map<string, CatalogsContent>;
}

function target(fields: Omit<PinTarget, "key">): PinTarget {
  return { ...fields, key: pinKey(fields.pin) };
}

/** Everything the person could pin, projects first. */
function pinTargets({
  projects,
  boards,
  tables,
  docs,
  catalogs,
}: Places): PinTarget[] {
  return [
    ...projects.map((project) =>
      target({
        href: `/p/${project.slug}`,
        icon: <ProjectAvatar project={project} />,
        kind: "Projects",
        pin: { address: project.address, type: "project" },
        title: project.title,
      })
    ),
    ...boards.map((board) =>
      target({
        href: boardPath(board, boards),
        icon: <SquareKanbanIcon className={ICON} />,
        kind: "Boards",
        pin: { address: board.address, type: "board" },
        place: projects.find((project) => inProject(board, project))?.title,
        title: board.title,
      })
    ),
    ...projects.flatMap((project) =>
      (tables.get(project.address) ?? []).map((table) =>
        target({
          href: tablePath(project, table),
          icon: <TableIcon className={ICON} icon={table.icon} />,
          kind: "Tables",
          pin: { address: table.address, type: "table" },
          place: project.title,
          title: table.title,
        })
      )
    ),
    ...projects.flatMap((project) =>
      (docs.get(project.address)?.pages ?? []).map((page) =>
        target({
          href: pagePath(project, page),
          icon: <PageIcon className="text-muted-foreground" page={page} />,
          kind: "Pages",
          pin: { id: page.id, project: project.address, type: "page" },
          place: project.title,
          title: pageTitle(page),
        })
      )
    ),
    ...projects.flatMap((project) =>
      (catalogs.get(project.address)?.catalogs ?? []).map((catalog) =>
        target({
          href: catalogPath(project, catalog),
          icon: <BookmarkIcon className={ICON} />,
          kind: "Catalogs",
          pin: { id: catalog.id, project: project.address, type: "catalog" },
          place: project.title,
          title: catalog.title,
        })
      )
    ),
  ];
}

function TargetText({ item }: { item: PinTarget }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate">{item.title}</span>
      {item.place && (
        <span className="text-muted-foreground truncate text-xs">
          {item.place}
        </span>
      )}
    </span>
  );
}

const TILE = "flex h-14 items-center gap-3 rounded-xl";

function PinTile({ item, onUnpin }: { item: PinTarget; onUnpin: () => void }) {
  return (
    <motion.li
      animate={{ opacity: 1, scale: 1 }}
      className="group/pin relative"
      exit={{ opacity: 0, scale: 0.96 }}
      initial={{ opacity: 0, scale: 0.96 }}
      layout="position"
      transition={{ duration: 0.18, ease: EASE_OUT }}
    >
      <Link
        className={cn(
          TILE,
          "bg-card shadow-surface hover:shadow-raised focus-visible:ring-ring/50 pr-10 pl-4 text-sm font-medium transition-[box-shadow,scale] duration-150 ease-out outline-none focus-visible:ring-3 active:scale-[0.99]"
        )}
        href={item.href}
      >
        {item.icon}
        <TargetText item={item} />
      </Link>
      <IconButton
        className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-focus-within/pin:opacity-100 group-hover/pin:opacity-100 pointer-coarse:opacity-100"
        label={`Unpin ${item.title}`}
        onClick={onUnpin}
      >
        <PinOffIcon />
      </IconButton>
    </motion.li>
  );
}

interface PickGroup {
  value: PinTarget["kind"];
  items: PinTarget[];
}

/** The dashed tile that finds something to pin. */
function PinPicker({
  targets,
  onPin,
}: {
  targets: PinTarget[];
  onPin: (pin: Pin) => void;
}) {
  const [query, setQuery] = useState("");
  const groups: PickGroup[] = (
    ["Projects", "Boards", "Tables", "Pages", "Catalogs"] as const
  ).flatMap((kind) => {
    const items = targets.filter((item) => item.kind === kind);
    return items.length > 0 ? [{ items, value: kind }] : [];
  });
  return (
    <Combobox.Root
      autoHighlight
      itemToStringLabel={(item: PinTarget) =>
        [item.title, item.place].filter(Boolean).join(" ")
      }
      items={groups}
      onInputValueChange={setQuery}
      onValueChange={(item: PinTarget | null) => {
        if (item) {
          onPin(item.pin);
        }
      }}
      value={null}
    >
      <Combobox.Trigger
        className={cn(
          TILE,
          "text-muted-foreground hover:text-foreground hover:bg-foreground/5 focus-visible:ring-ring/50 data-popup-open:bg-foreground/5 w-full justify-center gap-2 border border-dashed text-sm transition-colors duration-150 outline-none focus-visible:ring-3"
        )}
      >
        <PlusIcon aria-hidden className="size-4" />
        Pin
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner
          align="start"
          className="isolate z-50"
          sideOffset={6}
        >
          <Combobox.Popup className="bg-popover text-popover-foreground shadow-raised flex max-h-[min(24rem,var(--available-height))] w-[min(20rem,calc(100vw-2rem))] origin-(--transform-origin) flex-col overflow-hidden rounded-xl transition-[opacity,scale] duration-150 ease-out outline-none data-ending-style:scale-[0.96] data-ending-style:opacity-0 data-ending-style:duration-100 data-starting-style:scale-[0.96] data-starting-style:opacity-0">
            <div className="relative p-1.5 pb-0">
              <SearchIcon
                aria-hidden
                className="text-muted-foreground pointer-events-none absolute top-6 left-4 size-4 -translate-y-1/2"
              />
              <Combobox.Input
                aria-label="Find something to pin"
                autoCapitalize="off"
                autoCorrect="off"
                className={cn(FIELD, "h-9 pl-9")}
                placeholder="Find a project, board, table, page or catalog…"
                spellCheck={false}
              />
            </div>
            <Combobox.Empty className="text-muted-foreground px-3 py-6 text-center text-sm empty:hidden">
              {query.trim() ? "No matches" : "Nothing else to pin"}
            </Combobox.Empty>
            <Combobox.List className="flex flex-col overflow-y-auto overscroll-contain p-1 empty:hidden">
              {(group: PickGroup) => (
                <Combobox.Group items={group.items} key={group.value}>
                  <Combobox.GroupLabel className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-medium">
                    {group.value}
                  </Combobox.GroupLabel>
                  <Combobox.Collection>
                    {(item: PinTarget) => (
                      <Combobox.Item
                        className="data-highlighted:bg-accent data-highlighted:text-accent-foreground flex min-h-9 cursor-default items-center gap-2.5 rounded-lg px-2 py-1 text-sm outline-none select-none"
                        key={item.key}
                        value={item}
                      >
                        {item.icon}
                        <TargetText item={item} />
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

/** What the person pinned, in the order they pinned it, and the way to pin more. */
export function Pinned(props: Places & { loaded: boolean }) {
  const { prefs, setPinned } = useHome();
  const targets = pinTargets(props);
  const byKey = new Map(targets.map((item) => [item.key, item]));
  const pinnedKeys = new Set(prefs.pins.map(pinKey));
  const pinned = prefs.pins.flatMap((pin) => byKey.get(pinKey(pin)) ?? []);
  // Pins whose place hasn't loaded yet hold their spot meanwhile.
  const waiting = props.loaded ? 0 : prefs.pins.length - pinned.length;

  const unpin = (item: PinTarget) => {
    const undo = setPinned(item.pin, false);
    toast(`Unpinned ${item.title}`, {
      action: { label: "Undo", onClick: undo },
    });
  };

  return (
    <Section title="Pinned">
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <AnimatePresence initial={false}>
          {pinned.map((item) => (
            <PinTile item={item} key={item.key} onUnpin={() => unpin(item)} />
          ))}
        </AnimatePresence>
        {Array.from({ length: waiting }, (_, index) => (
          <li aria-hidden key={index}>
            <Skeleton className="h-14 rounded-xl" />
          </li>
        ))}
        <li>
          <PinPicker
            onPin={(pin) => setPinned(pin, true)}
            targets={targets.filter((item) => !pinnedKeys.has(item.key))}
          />
        </li>
      </ul>
    </Section>
  );
}
