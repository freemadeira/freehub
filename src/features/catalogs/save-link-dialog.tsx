import type { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import { usePlaces } from "@/components/app-link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { linkPath } from "@/features/catalogs/catalogs-context";
import { PasteBox } from "@/features/catalogs/paste-box";
import type { Saved } from "@/lib/catalog-actions";
import { hasReader } from "@/lib/catalog-actions";
import type { Catalog } from "@/lib/catalogs";
import { canEdit } from "@/lib/model";
import type { Project } from "@/lib/project";
import { plural, readStorage, writeStorage } from "@/lib/utils";

function lastKey(pubkey: string): string {
  return `save-link-catalog:${pubkey}`;
}

/** Catalogs the person can save links to, each with its project. */
export function useSavableCatalogs(
  pubkey: string
): { catalog: Catalog; project: Project }[] {
  const { catalogs, projects } = usePlaces();
  return projects
    .filter((project) => canEdit(project, pubkey))
    .flatMap((project) =>
      (catalogs.get(project.address)?.catalogs ?? []).map((catalog) => ({
        catalog,
        project,
      }))
    );
}

/**
 * Saves links from anywhere: pasted into the catalog picked, which is the
 * one used last until another is.
 */
export function SaveLinkDialog({
  open,
  onOpenChange,
  finalFocus,
  pubkey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus?: DialogPrimitive.Popup.Props["finalFocus"];
  pubkey: string;
}) {
  const [, navigate] = useLocation();
  const choices = useSavableCatalogs(pubkey);
  const [picked, setPicked] = useState(() => readStorage(lastKey(pubkey)));
  const chosen =
    choices.find((choice) => choice.catalog.id === picked) ?? choices[0];
  const projects = [
    ...new Map(
      choices.map(({ project }) => [project.address, project])
    ).values(),
  ];

  const onSaved = (saved: Saved) => {
    if (!chosen) {
      return;
    }
    writeStorage(lastKey(pubkey), chosen.catalog.id);
    onOpenChange(false);
    const first = saved.added[0] ?? saved.existing[0];
    const count = saved.added.length;
    toast.success(
      count === 0
        ? `Already in ${chosen.catalog.title}`
        : `Saved ${count === 1 ? "" : `${plural(count, "link")} `}to ${chosen.catalog.title}`,
      first
        ? {
            action: {
              label: "Open",
              onClick: () =>
                navigate(linkPath(chosen.project, chosen.catalog, first)),
            },
          }
        : undefined
    );
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg" finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>Save link</DialogTitle>
          {hasReader() && (
            <DialogDescription>
              It’s read, then titled, summed up and filed.
            </DialogDescription>
          )}
        </DialogHeader>
        {chosen ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>Catalog</Label>
              <Select
                onValueChange={(next: string | null) => {
                  if (next) {
                    setPicked(next);
                  }
                }}
                value={chosen.catalog.id}
              >
                <SelectTrigger aria-label="Catalog" className="w-full">
                  <SelectValue>
                    {chosen.catalog.title}
                    <span className="text-muted-foreground">
                      {" "}
                      · {chosen.project.title}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectGroup key={project.address}>
                      <SelectGroupLabel>{project.title}</SelectGroupLabel>
                      {choices
                        .filter(
                          (choice) => choice.project.address === project.address
                        )
                        .map(({ catalog }) => (
                          <SelectItem key={catalog.id} value={catalog.id}>
                            {catalog.title}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <PasteBox
              autoFocus
              catalog={chosen.catalog}
              className="ring-border shadow-none ring-1 focus-within:shadow-none"
              key={chosen.catalog.id}
              onSaved={onSaved}
              project={chosen.project}
              quiet
            />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            There’s no catalog to save to yet. Start one from a project’s page.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
