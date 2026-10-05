import { normalizeToPubkey } from "applesauce-core/helpers/pointers";
import { cn } from "cn";
import { XIcon } from "lucide-react";
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
import { UserAvatar } from "@/components/user-avatar";
import { useProfile } from "@/hooks/use-profile";
import { createBoard, deleteBoard, updateBoard } from "@/lib/actions";
import type { Board } from "@/lib/model";
import { CODE } from "@/lib/model";

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
  if (boards.some((item) => item.code === code && item.id !== board?.id)) {
    return "Another board uses this code.";
  }
  return null;
}

function parseMember(value: string): string | null {
  return normalizeToPubkey(value.trim().replace(/^nostr:/u, ""));
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

function MemberRow({
  pubkey,
  you,
  onRemove,
}: {
  pubkey: string;
  you: boolean;
  onRemove?: () => void;
}) {
  const { name } = useProfile(pubkey);
  return (
    <li className="flex h-10 items-center gap-2.5">
      <UserAvatar aria-hidden pubkey={pubkey} size="sm" />
      <span className="min-w-0 truncate">{name}</span>
      {you && <span className="text-muted-foreground">You</span>}
      {onRemove && (
        <Button
          aria-label={`Remove ${name}`}
          className="ml-auto"
          onClick={onRemove}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon />
        </Button>
      )}
    </li>
  );
}

interface MembersFieldProps {
  creator: string;
  members: string[];
  onChange: (members: string[]) => void;
  pubkey: string;
}

function MembersField({
  creator,
  members,
  onChange,
  pubkey,
}: MembersFieldProps) {
  const id = useId();
  const [candidate, setCandidate] = useState("");
  const [error, setError] = useState<string>();

  const add = () => {
    if (!candidate.trim()) {
      return;
    }
    const member = parseMember(candidate);
    if (!member) {
      setError("Not a valid npub.");
      return;
    }
    if (!members.includes(member)) {
      onChange([...members, member]);
    }
    setCandidate("");
  };

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Members</Label>
      <ul className="flex flex-col">
        {members.map((member) => (
          <MemberRow
            key={member}
            onRemove={
              member === creator
                ? undefined
                : () => onChange(members.filter((item) => item !== member))
            }
            pubkey={member}
            you={member === pubkey}
          />
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error ? true : undefined}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          id={id}
          onChange={(event) => {
            setCandidate(event.target.value);
            setError(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder="npub1…"
          spellCheck={false}
          value={candidate}
        />
        <Button
          disabled={!candidate.trim()}
          onClick={add}
          type="button"
          variant="outline"
        >
          Add
        </Button>
      </div>
      {error && (
        <p className="text-destructive text-xs" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
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
  pubkey: string;
  onDone: () => void;
}

function BoardForm({ board, boards, pubkey, onDone }: BoardFormProps) {
  const id = useId();
  const [, navigate] = useLocation();
  const [title, setTitle] = useState(board?.title ?? "");
  const [code, setCode] = useState(board?.code ?? "");
  const [codeEdited, setCodeEdited] = useState(board !== undefined);
  const [description, setDescription] = useState(board?.description ?? "");
  const [members, setMembers] = useState(board?.members ?? [pubkey]);

  const codeError = validateCode(code, boards, board);
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

      <MembersField
        creator={board?.creator ?? pubkey}
        members={members}
        onChange={setMembers}
        pubkey={pubkey}
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
