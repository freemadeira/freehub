import { Autocomplete } from "@base-ui/react/autocomplete";
import { cn } from "cn";
import { Link } from "wouter";

import { ShortcutKeys } from "@/components/shortcut-keys";
import type { SearchGroup, SearchItem } from "@/features/search/search-item";

const ITEM =
  "data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-50 flex min-h-10 cursor-default items-center gap-3 rounded-lg px-3 py-1.5 text-sm outline-none select-none";

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

/** The text with the words searched for picked out where they start a word. */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) {
    return text;
  }
  // Longest first, so a word another starts with doesn't cut it short.
  const words = terms.toSorted((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${words.map(escapeRegExp).join("|")})`,
    "giu"
  );
  return text.split(pattern).map((part, index) =>
    // Splitting on a group puts the matches at odd places.
    index % 2 === 1 ? (
      // oxlint-disable-next-line react/no-array-index-key -- parts repeat, their place is what tells them apart
      <mark
        className="text-foreground rounded-[3px] bg-transparent font-semibold"
        key={index}
      >
        {part}
      </mark>
    ) : (
      part
    )
  );
}

/** One item: its icon, title and where it is, and the words that matched inside it. */
export function SearchRow({
  item,
  terms,
}: {
  item: SearchItem;
  terms: string[];
}) {
  return (
    <>
      <span className="flex size-5 shrink-0 items-center justify-center">
        {item.icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate">
            <Highlight terms={terms} text={item.title} />
          </span>
          {item.context && (
            <span className="text-muted-foreground min-w-0 shrink truncate text-xs">
              {item.context}
            </span>
          )}
        </span>
        {item.snippet && (
          <span className="text-muted-foreground truncate text-xs">
            <Highlight terms={terms} text={item.snippet} />
          </span>
        )}
      </span>
      {item.keys && (
        <ShortcutKeys className="ml-2 pointer-coarse:hidden" keys={item.keys} />
      )}
    </>
  );
}

/**
 * The groups' items, keyboard and all, for an Autocomplete set up by the
 * caller. Places are links, so they open in a new tab too; `onOpen` hears of
 * every item opened.
 */
export function SearchList({
  terms,
  onOpen,
  className,
}: {
  terms: string[];
  onOpen: (item: SearchItem, event: Event) => void;
  className?: string;
}) {
  return (
    <Autocomplete.List className={cn("flex flex-col empty:hidden", className)}>
      {(group: SearchGroup) => (
        <Autocomplete.Group
          className="flex flex-col pb-1"
          items={group.items}
          key={group.value}
        >
          {group.quiet ? (
            <Autocomplete.GroupLabel className="sr-only">
              {group.label}
            </Autocomplete.GroupLabel>
          ) : (
            <div className="flex items-center gap-2 px-3 pt-3 pb-1">
              <Autocomplete.GroupLabel className="text-muted-foreground text-xs font-medium">
                {group.label}
              </Autocomplete.GroupLabel>
              {group.action && <span className="ml-auto">{group.action}</span>}
            </div>
          )}
          <Autocomplete.Collection>
            {(item: SearchItem) => (
              <Autocomplete.Item
                className={ITEM}
                key={item.key}
                onClick={(event) => onOpen(item, event.nativeEvent)}
                render={item.href ? <Link href={item.href} /> : undefined}
                value={item}
              >
                <SearchRow item={item} terms={terms} />
              </Autocomplete.Item>
            )}
          </Autocomplete.Collection>
        </Autocomplete.Group>
      )}
    </Autocomplete.List>
  );
}
