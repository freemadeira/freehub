import { cn } from "cn";
import type { FormEvent } from "react";
import { useId, useState } from "react";
import { useLocation } from "wouter";

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
import { TableIcon } from "@/features/crm/table-icon";
import type { CrmTable } from "@/lib/crm";
import { createTables } from "@/lib/crm-actions";
import type { TablePack } from "@/lib/crm-templates";
import { buildPack, MERCHANT_PACK, TABLE_PACKS } from "@/lib/crm-templates";
import type { Project } from "@/lib/project";

function PackOption({
  pack,
  selected,
  onSelect,
}: {
  pack: TablePack;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "focus-visible:ring-ring/50 flex items-start gap-3 rounded-xl p-3 text-left transition-[background-color,box-shadow] duration-150 outline-none focus-visible:ring-3",
        selected
          ? "bg-primary/10 inset-ring-primary inset-ring-2"
          : "hover:bg-foreground/5 inset-ring-border inset-ring"
      )}
      onClick={onSelect}
      type="button"
    >
      <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
        <TableIcon className="size-4" icon={pack.icon} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{pack.title}</span>
        <span className="text-muted-foreground text-xs leading-relaxed">
          {pack.description}
        </span>
        {pack.tables.length > 1 && (
          <span className="text-muted-foreground text-xs">
            {pack.tables.map((table) => table.title).join(" · ")}
          </span>
        )}
      </span>
    </button>
  );
}

interface NewTableFormProps {
  project: Project;
  tables: CrmTable[];
  pubkey: string;
  onDone: () => void;
}

function NewTableForm({ project, tables, pubkey, onDone }: NewTableFormProps) {
  const id = useId();
  const [, navigate] = useLocation();
  const [pack, setPack] = useState<TablePack>(MERCHANT_PACK);
  const [name, setName] = useState("");
  const single = pack.tables.length === 1;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const built = buildPack(
      pack,
      pubkey,
      tables.map((table) => table.slug),
      name
    );
    createTables(project, built);
    onDone();
    const [first] = built;
    if (first) {
      navigate(`/p/${project.slug}/${first.slug}`);
    }
  };

  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>New table</DialogTitle>
        <DialogDescription>
          Start from a template. Every field and stage can be changed later.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2 sm:grid-cols-2">
        {TABLE_PACKS.map((item) => (
          <PackOption
            key={item.id}
            onSelect={() => setPack(item)}
            pack={item}
            selected={item.id === pack.id}
          />
        ))}
      </div>
      {single && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input
            autoComplete="off"
            id={`${id}-name`}
            onChange={(event) => setName(event.target.value)}
            placeholder={pack.tables[0]?.title}
            value={name}
          />
        </div>
      )}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="ghost" />}>
          Cancel
        </DialogClose>
        <Button type="submit">
          {single ? "Create table" : `Create ${pack.tables.length} tables`}
        </Button>
      </DialogFooter>
    </form>
  );
}

type NewTableDialogProps = Omit<NewTableFormProps, "onDone"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function NewTableDialog({
  open,
  onOpenChange,
  ...props
}: NewTableDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-2xl" showCloseButton={false}>
        <NewTableForm {...props} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
