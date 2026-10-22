import { Combobox } from "@base-ui/react/combobox";
import { cn } from "cn";
import { CheckIcon, MinusIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { useCatalog } from "@/features/catalogs/catalog-context";
import { editCategories, newCategory } from "@/lib/catalog-actions";
import type { CatalogCategory } from "@/lib/catalogs";
import {
  categoryKey,
  cleanCategoryName,
  MAX_CATEGORIES,
  MAX_CATEGORY_NAME,
} from "@/lib/catalogs";
import { SWATCH_COLORS } from "@/lib/palette";

const ITEM =
  "group/choice data-highlighted:bg-accent data-highlighted:text-accent-foreground flex h-8 cursor-default items-center gap-2.5 rounded-lg px-2 text-sm outline-none select-none";
/** Looks like the app's checkbox; shows on the highlighted row and on picked ones. */
const CHECKBOX =
  "border-input bg-card dark:bg-input/30 group-data-selected/choice:border-primary group-data-selected/choice:bg-primary dark:group-data-selected/choice:bg-primary group-data-selected/choice:text-primary-foreground relative flex size-4 shrink-0 items-center justify-center rounded-[5px] border opacity-0 transition-[opacity,background-color,border-color] duration-150 group-data-highlighted/choice:opacity-100 group-data-selected/choice:opacity-100";

interface NewCategory {
  create: string;
}

type Choice = CatalogCategory | NewCategory;

function isNew(choice: Choice): choice is NewCategory {
  return "create" in choice;
}

function sameChoice(a: Choice, b: Choice): boolean {
  return !(isNew(a) || isNew(b)) && a.id === b.id;
}

function choiceName(choice: Choice): string {
  return isNew(choice) ? choice.create : choice.name;
}

/** The categories that match what's typed, and a new one when none is named that. */
function choicesFor(categories: CatalogCategory[], query: string): Choice[] {
  const needle = categoryKey(query);
  if (!needle) {
    return categories;
  }
  const found: Choice[] = categories.filter((category) =>
    categoryKey(category.name).includes(needle)
  );
  const named = categories.some(
    (category) => categoryKey(category.name) === needle
  );
  if (!named && categories.length < MAX_CATEGORIES) {
    found.push({ create: cleanCategoryName(query) });
  }
  return found;
}

/**
 * Picks categories from the catalog's, searching them by name; a name none
 * has yet makes a new one. For links picked together, categories only some
 * of them are in show a dash.
 */
export function CategoryPicker({
  value,
  partial,
  onChange,
  children,
  className,
  align = "start",
  "aria-label": label,
}: {
  /** Ids of the categories picked. */
  value: readonly string[];
  /** Ids of categories some of the links are in, but not all. */
  partial?: ReadonlySet<string>;
  onChange: (ids: string[]) => void;
  /** What the button that opens the picker shows. */
  children: ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
  "aria-label"?: string;
}) {
  const { catalog, project } = useCatalog();
  const [query, setQuery] = useState("");
  const picked = catalog.categories.filter((category) =>
    value.includes(category.id)
  );

  const pick = async (choices: Choice[]) => {
    const ids = choices.flatMap((choice) => (isNew(choice) ? [] : [choice.id]));
    const made = choices.find(isNew);
    if (made) {
      const category = newCategory(catalog, made.create);
      setQuery("");
      const saved = await editCategories(project, catalog, [
        ...catalog.categories,
        category,
      ]);
      if (!saved) {
        return;
      }
      ids.push(category.id);
    }
    onChange(ids);
  };

  return (
    <Combobox.Root
      autoHighlight
      filter={null}
      inputValue={query}
      isItemEqualToValue={sameChoice}
      itemToStringLabel={choiceName}
      items={choicesFor(catalog.categories, query)}
      multiple
      onInputValueChange={setQuery}
      onValueChange={pick}
      value={picked as Choice[]}
    >
      <Combobox.Trigger aria-label={label} className={className}>
        {children}
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner
          align={align}
          className="isolate z-50"
          sideOffset={6}
        >
          <Combobox.Popup className="bg-popover text-popover-foreground shadow-raised flex max-h-[min(22rem,var(--available-height))] w-64 origin-(--transform-origin) flex-col overflow-hidden rounded-xl transition-[opacity,scale] duration-150 ease-out outline-none data-ending-style:scale-[0.96] data-ending-style:opacity-0 data-ending-style:duration-100 data-starting-style:scale-[0.96] data-starting-style:opacity-0">
            <Combobox.Input
              aria-label="Search or add categories"
              autoCapitalize="off"
              autoCorrect="off"
              className="border-border placeholder:text-muted-foreground h-10 shrink-0 border-b bg-transparent px-3 text-base outline-none md:text-sm"
              maxLength={MAX_CATEGORY_NAME}
              placeholder="File under…"
              spellCheck={false}
            />
            <Combobox.Empty className="text-muted-foreground px-3 py-5 text-center text-sm text-balance empty:hidden">
              {query.trim()
                ? `No categories match “${query.trim()}”.`
                : "No categories yet. Type a name to make one."}
            </Combobox.Empty>
            <Combobox.List className="min-h-0 overflow-y-auto overscroll-contain p-1 empty:hidden">
              {(choice: Choice) =>
                isNew(choice) ? (
                  <Combobox.Item className={ITEM} key="new" value={choice}>
                    <PlusIcon
                      aria-hidden
                      className="text-muted-foreground size-4 shrink-0"
                    />
                    <span className="truncate">
                      <span className="text-muted-foreground">
                        New category:{" "}
                      </span>
                      {`“${choice.create}”`}
                    </span>
                  </Combobox.Item>
                ) : (
                  <Combobox.Item
                    className={ITEM}
                    key={choice.id}
                    value={choice}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        CHECKBOX,
                        partial?.has(choice.id) &&
                          "border-primary bg-primary/15 opacity-100"
                      )}
                    >
                      <CheckIcon
                        className="size-3 opacity-0 group-data-selected/choice:opacity-100"
                        strokeWidth={3}
                      />
                      {partial?.has(choice.id) && (
                        <MinusIcon
                          className="text-primary absolute size-3 group-data-selected/choice:hidden"
                          strokeWidth={3}
                        />
                      )}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "size-2.5 shrink-0 rounded-full",
                        SWATCH_COLORS[choice.color]
                      )}
                    />
                    <span className="truncate">{choice.name}</span>
                  </Combobox.Item>
                )
              }
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
