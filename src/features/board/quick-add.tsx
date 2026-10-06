import { PlusIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** The quiet "+ Add …" button at the foot of a column or list. */
export function AddButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className="text-muted-foreground hover:bg-foreground/5 w-full justify-start rounded-lg"
      onClick={onClick}
      size="sm"
      variant="ghost"
    >
      <PlusIcon />
      {label}
    </Button>
  );
}

/** An add button that turns into a title field, for adding many items fast. */
export function QuickAdd({
  onAdd,
  label,
  placeholder,
}: {
  onAdd: (title: string) => void;
  label: string;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  if (!open) {
    return <AddButton label={label} onClick={() => setOpen(true)} />;
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (title.trim()) {
      onAdd(title.trim());
      setTitle("");
    }
  };

  return (
    <form onSubmit={submit}>
      <Input
        aria-label={placeholder}
        autoComplete="off"
        autoFocus
        onBlur={(event) => {
          if (!event.currentTarget.value.trim()) {
            setOpen(false);
          }
        }}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setTitle("");
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        value={title}
      />
    </form>
  );
}
