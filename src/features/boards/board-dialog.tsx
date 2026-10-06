import { cn } from "cn";
import type { FormEvent } from "react";
import { useId, useState } from "react";
import { useLocation } from "wouter";

import { MembersField } from "@/components/members-field";
import { ProjectAvatar } from "@/components/project-avatar";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useEveryBoard } from "@/hooks/use-boards";
import { createBoard, deleteBoard, updateBoard } from "@/lib/actions";
import type { Board } from "@/lib/model";
import { CODE, RESERVED_CODES } from "@/lib/model";
import type { Project } from "@/lib/project";

const DIACRITICS = /\p{Diacritic}/gu;

function deriveCode(title: string): string {
  const words = title
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/u)
    .filter(Boolean);
  const code =
    words.length > 1
      ? words.map((word) => word[0]).join("")
      : (words[0] ?? "").slice(0, 4);
  return code.replace(/^\d+/u, "").slice(0, 10);
}

function cleanCode(value: string): string {
  return value
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]/gu, "")
    .slice(0, 10);
}

function validateCode(
  code: string,
  boards: Board[],
  board?: Board
): string | null {
  if (code && !CODE.test(code)) {
    return "Start with a letter.";
  }
  if (RESERVED_CODES.has(code)) {
    return "The app uses this code.";
  }
  if (
    boards.some((item) => item.code === code && item.address !== board?.address)
  ) {
    return "Another board uses this code.";
  }
  return null;
}

function KeyField({
  error,
  onChange,
  value,
}: {
  error: string | null;
  onChange: (value: string) => void;
  value: string;
}) {
  const id = useId();
  const key = value || "KEY";
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>Key</Label>
        <Input
          aria-describedby={`${id}-hint`}
          aria-invalid={error ? true : undefined}
          autoCapitalize="characters"
          autoComplete="off"
          className="font-mono uppercase"
          id={id}
          onChange={(event) => onChange(cleanCode(event.target.value))}
          spellCheck={false}
          value={value}
        />
      </div>
      <p
        className={cn(
          "col-span-2 -mt-1 text-xs",
          error ? "text-destructive" : "text-muted-foreground"
        )}
        id={`${id}-hint`}
      >
        {error ?? `Cards are numbered ${key}-1, ${key}-2, …`}
      </p>
    </>
  );
}

function ProjectField({
  projects,
  value,
  onChange,
}: {
  projects: Project[];
  value?: string;
  onChange: (project?: string) => void;
}) {
  const id = useId();
  const options = [
    {
      label: <span className="text-muted-foreground">No project</span>,
      value: null,
    },
    ...projects.map((project) => ({
      label: (
        <>
          <ProjectAvatar project={project} />
          <span className="truncate">{project.title}</span>
        </>
      ),
      value: project.address,
    })),
  ];
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Project</Label>
      <Select
        items={options}
        onValueChange={(next: string | null) => onChange(next ?? undefined)}
        value={value ?? null}
      >
        <SelectTrigger className="w-full" id={id}>
          <SelectValue className="items-center gap-2" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value ?? "none"} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DeleteBoard({
  board,
  onDeleted,
}: {
  board: Board;
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
        Delete board
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {board.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its cards and sprints disappear for everyone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              deleteBoard(board);
              onDeleted();
              navigate("/", { replace: true });
            }}
            variant="destructive"
          >
            Delete board
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface BoardFormProps {
  board?: Board;
  boards: Board[];
  projects: Project[];
  /** Project a new board starts in. */
  project?: Project;
  pubkey: string;
  onDone: () => void;
}

// A new board in a project starts with the project's people.
function initialDraft(
  board: Board | undefined,
  project: Project | undefined,
  pubkey: string
) {
  if (board) {
    return board;
  }
  return {
    code: "",
    description: "",
    members: project?.members ?? [pubkey],
    project: project?.address,
    title: "",
  };
}

function BoardForm({
  board,
  boards,
  projects,
  project,
  pubkey,
  onDone,
}: BoardFormProps) {
  const id = useId();
  const [, navigate] = useLocation();
  // Only read on the first render, as the starting values.
  const initial = initialDraft(board, project, pubkey);
  const [title, setTitle] = useState(initial.title);
  const [code, setCode] = useState(initial.code);
  const [codeEdited, setCodeEdited] = useState(board !== undefined);
  const [description, setDescription] = useState(initial.description);
  const [members, setMembers] = useState(initial.members);
  const [projectAddress, setProjectAddress] = useState(initial.project);
  const parent = projects.find((item) => item.address === projectAddress);
  // Includes boards the user isn't in, which teammates may still see beside theirs.
  const everyBoard = useEveryBoard();

  const codeError = validateCode(code, [...boards, ...everyBoard], board);
  const valid = title.trim() !== "" && code !== "" && !codeError;

  const changeTitle = (value: string) => {
    setTitle(value);
    if (!codeEdited) {
      setCode(deriveCode(value));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) {
      return;
    }
    const draft = {
      code,
      description: description.trim(),
      members,
      project: projectAddress,
      title: title.trim(),
    };
    if (board) {
      updateBoard(board, draft);
    } else {
      createBoard(pubkey, draft);
    }
    onDone();
    if (code !== board?.code) {
      navigate(`/${code}`, { replace: board !== undefined });
    }
  };

  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{board ? "Board settings" : "New board"}</DialogTitle>
      </DialogHeader>

      <div className="grid grid-cols-[1fr_7.5rem] gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-title`}>Name</Label>
          <Input
            autoComplete="off"
            autoFocus={!board}
            id={`${id}-title`}
            onChange={(event) => changeTitle(event.target.value)}
            value={title}
          />
        </div>
        <KeyField
          error={codeError}
          onChange={(value) => {
            setCode(value);
            setCodeEdited(true);
          }}
          value={code}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-description`}>Description</Label>
        <Textarea
          id={`${id}-description`}
          onChange={(event) => setDescription(event.target.value)}
          value={description}
        />
      </div>

      {projects.length > 0 && (
        <ProjectField
          onChange={setProjectAddress}
          projects={projects}
          value={projectAddress}
        />
      )}

      <MembersField
        creator={board?.creator ?? pubkey}
        members={members}
        onChange={setMembers}
        pubkey={pubkey}
        group={parent && { members: parent.members, name: parent.title }}
      />

      <DialogFooter className="mt-1">
        {board && <DeleteBoard board={board} onDeleted={onDone} />}
        <DialogClose render={<Button type="button" variant="ghost" />}>
          Cancel
        </DialogClose>
        <Button disabled={!valid} type="submit">
          {board ? "Save" : "Create board"}
        </Button>
      </DialogFooter>
    </form>
  );
}

type BoardDialogProps = Omit<BoardFormProps, "onDone"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function BoardDialog({
  open,
  onOpenChange,
  ...props
}: BoardDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent showCloseButton={false}>
        <BoardForm {...props} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
