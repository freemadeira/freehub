import { cn } from "cn";
import { ArrowUpIcon, Link2Icon } from "lucide-react";
import type { KeyboardEvent, Ref } from "react";
import { useState } from "react";

import { IconButton } from "@/components/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { PlatformIcon } from "@/features/catalogs/platform-icon";
import type { Saved } from "@/lib/catalog-actions";
import { saveLinks } from "@/lib/catalog-actions";
import type { Catalog } from "@/lib/catalogs";
import {
  hostOf,
  MAX_LINKS_AT_ONCE,
  platformOf,
  splitPasted,
} from "@/lib/catalogs";
import type { Project } from "@/lib/project";
import { plural } from "@/lib/utils";

/** Links shown under the box as they're found, before the rest fold into a count. */
const SHOWN_FOUND = 3;

function shortAddress(url: string): string {
  try {
    const { pathname } = new URL(url);
    const path = pathname.length > 1 ? pathname : "";
    return `${hostOf(url)}${path}`;
  } catch {
    return url;
  }
}

/**
 * Where links are pasted to be saved, as many as wanted at once, with
 * anything else written as their note. What it'll save shows as it's typed.
 */
export function PasteBox({
  project,
  catalog,
  onSaved,
  autoFocus = false,
  quiet = false,
  className,
  ref,
}: {
  project: Project;
  catalog: Pick<Catalog, "id" | "title">;
  onSaved?: (saved: Saved) => void;
  /** Leaves saying what was saved to `onSaved`. */
  quiet?: boolean;
  autoFocus?: boolean;
  className?: string;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const { links, note } = splitPasted(text);
  const tooMany = links.length > MAX_LINKS_AT_ONCE;
  const ready = links.length > 0 && !tooMany && !saving;
  const found = note
    ? `${plural(links.length, "link")}, with your note`
    : plural(links.length, "link");

  const save = async () => {
    if (!ready) {
      return;
    }
    setSaving(true);
    const saved = await saveLinks(project, catalog, text, { quiet });
    setSaving(false);
    if (saved) {
      setText("");
      onSaved?.(saved);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      save();
    } else if (event.key === "Escape" && text) {
      event.stopPropagation();
      setText("");
    }
  };

  return (
    <form
      className={cn(
        "bg-card shadow-surface focus-within:shadow-raised flex flex-col rounded-2xl transition-shadow duration-200",
        className
      )}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="flex items-start gap-1 p-1.5 pl-3.5">
        <Link2Icon
          aria-hidden
          className={cn(
            "mt-2.5 size-4 shrink-0 transition-colors duration-150",
            links.length > 0 ? "text-primary" : "text-muted-foreground"
          )}
        />
        <Textarea
          aria-label="Links to save"
          autoFocus={autoFocus}
          className="max-h-48 min-h-9 flex-1 resize-none rounded-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Paste links to save, with a note if you like…"
          readOnly={saving}
          ref={ref}
          rows={1}
          value={text}
        />
        <IconButton
          className="mt-px shrink-0"
          disabled={!ready}
          label={links.length > 1 ? `Save ${links.length} links` : "Save"}
          tooltip={
            <span className="flex items-center gap-1.5">
              Save <Kbd>↵</Kbd>
            </span>
          }
          type="submit"
          variant={ready || saving ? "default" : "secondary"}
        >
          {saving ? <Spinner /> : <ArrowUpIcon />}
        </IconButton>
      </div>
      {links.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-3.5 pb-3 text-xs">
          {links.slice(0, SHOWN_FOUND).map((link) => (
            <span
              className="bg-foreground/5 flex h-6 max-w-64 min-w-0 items-center gap-1.5 rounded-full px-2"
              key={link}
            >
              <PlatformIcon
                className="size-3.5 shrink-0"
                platform={platformOf(link)}
              />
              <span className="truncate">{shortAddress(link)}</span>
            </span>
          ))}
          {links.length > SHOWN_FOUND && (
            <span className="text-muted-foreground tabular-nums">
              +{links.length - SHOWN_FOUND} more
            </span>
          )}
          <span
            className={cn(
              "ml-auto",
              tooMany ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {tooMany ? `Up to ${MAX_LINKS_AT_ONCE} at a time` : found}
          </span>
        </div>
      )}
    </form>
  );
}
