import type { FormEvent } from "react";
import { useId, useState } from "react";
import { useLocation } from "wouter";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
import { brandingPath, brandPath } from "@/features/branding/branding-context";
import { createBrand, deleteBrand } from "@/lib/brand-actions";
import type { Brand } from "@/lib/brands";
import { MAX_BRAND_DESCRIPTION, MAX_BRAND_NAME } from "@/lib/brands";
import type { Project } from "@/lib/project";

function NewBrandForm({
  project,
  onDone,
}: {
  project: Project;
  onDone: () => void;
}) {
  const id = useId();
  const [, navigate] = useLocation();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const valid = title.trim() !== "";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) {
      return;
    }
    setSaving(true);
    const made = createBrand(project, {
      description,
      socials: [],
      title,
      website: "",
    });
    const saved = await made?.saved;
    setSaving(false);
    if (made && saved) {
      onDone();
      navigate(brandPath(project, { id: made.id, title }));
    }
  };

  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>New brand</DialogTitle>
        <DialogDescription>
          Logos, colors, typefaces and how to use them, in one place.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-title`}>Name</Label>
        <Input
          autoComplete="off"
          autoFocus
          id={`${id}-title`}
          maxLength={MAX_BRAND_NAME}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Free Madeira"
          value={title}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-description`}>What it stands for</Label>
        <Textarea
          id={`${id}-description`}
          maxLength={MAX_BRAND_DESCRIPTION}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="A line or two, as the brand would say it."
          value={description}
        />
      </div>
      <DialogFooter className="mt-1">
        <DialogClose render={<Button type="button" variant="ghost" />}>
          Cancel
        </DialogClose>
        <Button disabled={!valid || saving} type="submit">
          {saving && <Spinner />}
          Create brand
        </Button>
      </DialogFooter>
    </form>
  );
}

export function NewBrandDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto"
        showCloseButton={false}
      >
        <NewBrandForm onDone={() => onOpenChange(false)} project={project} />
      </DialogContent>
    </Dialog>
  );
}

/** Asks before the brand goes for everyone, with all its files. */
export function DeleteBrandDialog({
  project,
  brand,
  open,
  onOpenChange,
}: {
  project: Project;
  brand: Brand;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, navigate] = useLocation();
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {brand.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its logos, colors, typefaces, files and guidelines disappear for
            everyone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              deleteBrand(project, brand);
              navigate(brandingPath(project), { replace: true });
            }}
            variant="destructive"
          >
            Delete brand
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
