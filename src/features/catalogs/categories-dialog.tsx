import { cn } from "cn";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";

import { ColorPicker } from "@/components/color-picker";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { swap } from "@/features/crm/options-editor";
import { editCategories, hasReader, newCategory } from "@/lib/catalog-actions";
import type { Catalog, CatalogCategory } from "@/lib/catalogs";
import {
  categoryKey,
  cleanCategoryName,
  MAX_CATEGORIES,
  MAX_CATEGORY_NAME,
} from "@/lib/catalogs";
import { SWATCH_COLORS } from "@/lib/palette";
import type { Project } from "@/lib/project";

function CategoryRow({
  category,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  category: CatalogCategory;
  index: number;
  count: number;
  onChange: (category: CatalogCategory) => void;
  onMove: (offset: number) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <Popover>
        <PopoverTrigger
          aria-label={`Color of ${category.name}`}
          className="hover:bg-foreground/5 focus-visible:ring-ring/50 flex size-8 shrink-0 items-center justify-center rounded-lg outline-none focus-visible:ring-3"
        >
          <span
            className={cn(
              "size-3.5 rounded-full",
              SWATCH_COLORS[category.color]
            )}
          />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-3">
          <ColorPicker
            className="w-44"
            onChange={(color) => onChange({ ...category, color })}
            value={category.color}
          />
        </PopoverContent>
      </Popover>
      <input
        aria-label="Category name"
        className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/30 dark:bg-input/30 h-8 min-w-0 flex-1 rounded-lg border px-2.5 text-base outline-none focus-visible:ring-3 md:text-sm"
        maxLength={MAX_CATEGORY_NAME}
        onChange={(event) =>
          onChange({ ...category, name: event.target.value })
        }
        value={category.name}
      />
      <div className="flex shrink-0 items-center max-sm:hidden">
        <IconButton
          disabled={index === 0}
          label="Move up"
          onClick={() => onMove(-1)}
          size="icon-xs"
        >
          <ArrowUpIcon />
        </IconButton>
        <IconButton
          disabled={index === count - 1}
          label="Move down"
          onClick={() => onMove(1)}
          size="icon-xs"
        >
          <ArrowDownIcon />
        </IconButton>
      </div>
      <IconButton
        label={`Remove ${category.name}`}
        onClick={onRemove}
        size="icon-xs"
      >
        <XIcon />
      </IconButton>
    </li>
  );
}

/** What's wrong with the categories as written, if anything. */
function problemOf(categories: CatalogCategory[]): string | undefined {
  const names = new Set<string>();
  for (const category of categories) {
    const name = cleanCategoryName(category.name);
    if (!name) {
      return "Name each category.";
    }
    if (names.has(categoryKey(name))) {
      return `There are two categories named “${name}”.`;
    }
    names.add(categoryKey(name));
  }
  return undefined;
}

function CategoriesForm({
  project,
  catalog,
  onDone,
}: {
  project: Project;
  catalog: Catalog;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(catalog.categories);
  const [saving, setSaving] = useState(false);
  const problem = problemOf(draft);
  const changed = JSON.stringify(draft) !== JSON.stringify(catalog.categories);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (problem) {
      return;
    }
    if (!changed) {
      onDone();
      return;
    }
    setSaving(true);
    const saved = await editCategories(project, catalog, draft);
    setSaving(false);
    if (saved) {
      onDone();
    }
  };

  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Categories</DialogTitle>
        <DialogDescription>
          {hasReader()
            ? "Each link is filed under up to three of them as it’s read. New ones suggested show up beside them, to add or wave away. Deleting one leaves its links where they are."
            : "Each link can be filed under up to three of them. Deleting one leaves its links where they are."}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        {draft.length > 0 && (
          <FluidTooltip.Group>
            <ul className="flex flex-col gap-1">
              {draft.map((category, index) => (
                <CategoryRow
                  category={category}
                  count={draft.length}
                  index={index}
                  key={category.id}
                  onChange={(next) =>
                    setDraft(
                      draft.map((item) =>
                        item.id === category.id ? next : item
                      )
                    )
                  }
                  onMove={(offset) => setDraft(swap(draft, index, offset))}
                  onRemove={() =>
                    setDraft(draft.filter((item) => item.id !== category.id))
                  }
                />
              ))}
            </ul>
          </FluidTooltip.Group>
        )}
        {draft.length < MAX_CATEGORIES && (
          <Button
            className="self-start"
            onClick={() =>
              setDraft([
                ...draft,
                newCategory(
                  { categories: draft },
                  `Category ${draft.length + 1}`
                ),
              ])
            }
            size="sm"
            type="button"
            variant="ghost"
          >
            <PlusIcon />
            Add category
          </Button>
        )}
        {problem && changed && (
          <p className="text-destructive text-sm">{problem}</p>
        )}
      </div>
      <DialogFooter className="mt-1">
        <DialogClose render={<Button type="button" variant="ghost" />}>
          Cancel
        </DialogClose>
        <Button disabled={Boolean(problem) || saving} type="submit">
          {saving && <Spinner />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The catalog's categories: renamed, recolored, added or deleted. */
export function CategoriesDialog({
  project,
  catalog,
  open,
  onOpenChange,
}: {
  project: Project;
  catalog: Catalog;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto"
        showCloseButton={false}
      >
        <CategoriesForm
          catalog={catalog}
          onDone={() => onOpenChange(false)}
          project={project}
        />
      </DialogContent>
    </Dialog>
  );
}
