import type { FormEvent } from "react";
import { useId, useState } from "react";
import { useLocation } from "wouter";

import { usePlaces } from "@/components/app-link";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  catalogPath,
  catalogsPath,
} from "@/features/catalogs/catalogs-context";
import {
  createCatalog,
  deleteCatalog,
  hasReader,
  updateCatalog,
} from "@/lib/catalog-actions";
import type { Catalog } from "@/lib/catalogs";
import { MAX_CATALOG_DESCRIPTION, MAX_CATALOG_NAME } from "@/lib/catalogs";
import type { Project } from "@/lib/project";
import { plural } from "@/lib/utils";

function DeleteCatalog({
  project,
  catalog,
  onDeleted,
}: {
  project: Project;
  catalog: Catalog;
  onDeleted: () => void;
}) {
  const [, navigate] = useLocation();
  const links =
    usePlaces().catalogs.get(project.address)?.linksIn.get(catalog.id)
      ?.length ?? 0;
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button className="sm:mr-auto" type="button" variant="destructive" />
        }
      >
        Delete catalog
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {catalog.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            {links > 0
              ? `Its ${plural(links, "link")}, with their notes and comments, disappear for everyone.`
              : "It disappears for everyone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              deleteCatalog(project, catalog);
              onDeleted();
              navigate(catalogsPath(project), { replace: true });
            }}
            variant="destructive"
          >
            Delete catalog
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface CatalogFormProps {
  project: Project;
  /** The catalog to change; a new one starts otherwise. */
  catalog?: Catalog;
  /** Whether whoever's here may delete it. */
  manageable?: boolean;
  onDone: () => void;
}

function CatalogForm({
  project,
  catalog,
  manageable = false,
  onDone,
}: CatalogFormProps) {
  const id = useId();
  const [, navigate] = useLocation();
  const [title, setTitle] = useState(catalog?.title ?? "");
  const [description, setDescription] = useState(catalog?.description ?? "");
  const [saving, setSaving] = useState(false);
  const valid = title.trim() !== "";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) {
      return;
    }
    const draft = { description: description.trim(), title: title.trim() };
    setSaving(true);
    if (catalog) {
      const saved = await updateCatalog(project, catalog, draft);
      setSaving(false);
      if (saved) {
        onDone();
      }
      return;
    }
    const made = createCatalog(project, draft);
    const saved = await made?.saved;
    setSaving(false);
    if (made && saved) {
      onDone();
      navigate(catalogPath(project, { id: made.id, title: draft.title }));
    }
  };

  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{catalog ? "Catalog details" : "New catalog"}</DialogTitle>
        {!catalog && (
          <DialogDescription>
            {hasReader()
              ? "Paste videos, posts and articles into it. Each one is read, then titled, summed up and filed for you."
              : "Paste videos, posts and articles into it, and file them under categories."}
          </DialogDescription>
        )}
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-title`}>Name</Label>
        <Input
          autoComplete="off"
          autoFocus={!catalog}
          id={`${id}-title`}
          maxLength={MAX_CATALOG_NAME}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Competitor research"
          value={title}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-description`}>What it’s for</Label>
        <Textarea
          id={`${id}-description`}
          maxLength={MAX_CATALOG_DESCRIPTION}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={
            hasReader()
              ? "What goes in it, in a line or two. The AI reads this too, to file links well."
              : "What goes in it, in a line or two."
          }
          value={description}
        />
      </div>

      <DialogFooter className="mt-1">
        {catalog && manageable && (
          <DeleteCatalog
            catalog={catalog}
            onDeleted={onDone}
            project={project}
          />
        )}
        <DialogClose render={<Button type="button" variant="ghost" />}>
          Cancel
        </DialogClose>
        <Button disabled={!valid || saving} type="submit">
          {saving && <Spinner />}
          {catalog ? "Save" : "Create catalog"}
        </Button>
      </DialogFooter>
    </form>
  );
}

type CatalogDialogProps = Omit<CatalogFormProps, "onDone"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CatalogDialog({
  open,
  onOpenChange,
  ...props
}: CatalogDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto"
        showCloseButton={false}
      >
        <CatalogForm {...props} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
