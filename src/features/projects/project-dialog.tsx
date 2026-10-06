import { cn } from "cn";
import type { FormEvent } from "react";
import { useId, useState } from "react";
import { useLocation } from "wouter";

import { ColorPicker } from "@/components/color-picker";
import { fromRoster, MembersField, toRoster } from "@/components/members-field";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useEveryProject } from "@/hooks/use-projects";
import { createProject, deleteProject, updateProject } from "@/lib/actions";
import type { Color } from "@/lib/palette";
import type { Project } from "@/lib/project";
import { cleanSlugInput, slugify, uniqueSlug } from "@/lib/project";

function DeleteProject({
  project,
  onDeleted,
}: {
  project: Project;
  onDeleted: () => void;
}) {
  const [, navigate] = useLocation();
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button className="sm:mr-auto" type="button" variant="destructive" />
        }
      >
        Delete project
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {project.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its CRM tables disappear for everyone. Boards in it are kept and
            move out of the project.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              deleteProject(project);
              onDeleted();
              navigate("/", { replace: true });
            }}
            variant="destructive"
          >
            Delete project
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SlugField({
  value,
  taken,
  onChange,
}: {
  value: string;
  taken: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Link</Label>
      <div className="border-input bg-card focus-within:border-ring focus-within:ring-ring/30 has-aria-invalid:border-destructive has-aria-invalid:ring-destructive/20 dark:bg-input/30 flex h-9 items-center rounded-lg border pl-3 transition-[border-color,box-shadow] focus-within:ring-3 has-aria-invalid:ring-3">
        <span className="text-muted-foreground font-mono text-sm select-none">
          /p/
        </span>
        <input
          aria-describedby={`${id}-hint`}
          aria-invalid={taken ? true : undefined}
          autoCapitalize="off"
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent pr-3 font-mono text-base outline-none md:text-sm"
          id={id}
          onChange={(event) => onChange(cleanSlugInput(event.target.value))}
          spellCheck={false}
          value={value}
        />
      </div>
      <p
        className={cn(
          "-mt-1 text-xs",
          taken ? "text-destructive" : "text-muted-foreground"
        )}
        id={`${id}-hint`}
      >
        {taken
          ? "Another project uses this link."
          : "Letters, numbers and hyphens."}
      </p>
    </div>
  );
}

interface ProjectFormProps {
  project?: Project;
  projects: Project[];
  pubkey: string;
  onDone: () => void;
}

function ProjectForm({ project, projects, pubkey, onDone }: ProjectFormProps) {
  const id = useId();
  const [, navigate] = useLocation();
  const [title, setTitle] = useState(project?.title ?? "");
  const [slug, setSlug] = useState(project?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(project !== undefined);
  const [description, setDescription] = useState(project?.description ?? "");
  const [color, setColor] = useState<Color>(project?.color ?? "yellow");
  const [roster, setRoster] = useState(() =>
    toRoster(project ?? { members: [pubkey], viewers: [] })
  );

  // Includes projects the user isn't in, which teammates may still see beside theirs.
  const everyProject = useEveryProject();
  const takenSlugs = new Set(
    [...projects, ...everyProject]
      .filter((item) => item.address !== project?.address)
      .map((item) => item.slug)
  );
  const finalSlug = slugify(slug);
  const taken = takenSlugs.has(finalSlug);
  const valid = title.trim() !== "" && finalSlug !== "" && !taken;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) {
      return;
    }
    const draft = {
      ...fromRoster(roster),
      color,
      description: description.trim(),
      slug: finalSlug,
      title: title.trim(),
    };
    if (project) {
      updateProject(project, draft);
    } else {
      createProject(pubkey, draft);
    }
    onDone();
    if (finalSlug !== project?.slug) {
      navigate(`/p/${finalSlug}`, { replace: project !== undefined });
    }
  };

  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>
          {project ? "Project settings" : "New project"}
        </DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-title`}>Name</Label>
        <Input
          autoComplete="off"
          autoFocus={!project}
          id={`${id}-title`}
          onChange={(event) => {
            setTitle(event.target.value);
            if (!slugEdited) {
              const base = slugify(event.target.value);
              setSlug(base && uniqueSlug(base, takenSlugs));
            }
          }}
          placeholder="Bitcoin Madeira"
          value={title}
        />
      </div>

      <SlugField
        onChange={(value) => {
          setSlug(value);
          setSlugEdited(true);
        }}
        taken={taken}
        value={slug}
      />

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-description`}>Description</Label>
        <Textarea
          id={`${id}-description`}
          onChange={(event) => setDescription(event.target.value)}
          value={description}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium select-none" id={`${id}-color`}>
          Color
        </span>
        <ColorPicker
          aria-labelledby={`${id}-color`}
          onChange={setColor}
          value={color}
        />
      </div>

      <MembersField
        creator={project?.creator ?? pubkey}
        onChange={setRoster}
        pubkey={pubkey}
        roster={roster}
      />

      <DialogFooter className="mt-1">
        {project && <DeleteProject onDeleted={onDone} project={project} />}
        <DialogClose render={<Button type="button" variant="ghost" />}>
          Cancel
        </DialogClose>
        <Button disabled={!valid} type="submit">
          {project ? "Save" : "Create project"}
        </Button>
      </DialogFooter>
    </form>
  );
}

type ProjectDialogProps = Omit<ProjectFormProps, "onDone"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProjectDialog({
  open,
  onOpenChange,
  ...props
}: ProjectDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent showCloseButton={false}>
        <ProjectForm {...props} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
