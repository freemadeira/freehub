import { PlusIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function QuickAdd({
  onAdd,
  label = "Add card",
  placeholder = "Card title",
}: {
  onAdd: (title: string) => void;
  label?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  if (!open) {
    return (
      <Button
        className="text-muted-foreground hover:bg-foreground/5 w-full justify-start rounded-lg"
        onClick={() => setOpen(true)}
        size="sm"
        variant="ghost"
      >
        <PlusIcon />
        {label}
      </Button>
    );
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
