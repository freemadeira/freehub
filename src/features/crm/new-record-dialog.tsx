import type { FormEvent } from "react";
import { Fragment, useId, useState } from "react";

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
import { useCrm } from "@/features/crm/crm-context";
import { FieldInput } from "@/features/crm/field-input";
import type { CrmRecordFields, Field } from "@/lib/crm";
import { stageField, titleField } from "@/lib/crm";
import { createRecord } from "@/lib/crm-actions";
import { rankBetween } from "@/lib/model";

/** The few fields worth setting up front: stage, owner and the first select. */
function quickFields(fields: Field[]): Field[] {
  const picked = [
    fields.find((field) => field.type === "stage"),
    fields.find((field) => field.type === "member"),
    fields.find((field) => field.type === "select"),
  ];
  return picked.filter((field) => field !== undefined);
}

function NewRecordForm({ onDone }: { onDone: (id?: string) => void }) {
  const id = useId();
  const { pubkey, records, table } = useCrm();
  const stage = stageField(table);
  const fields = quickFields(table.fields);
  const owner = fields.find((field) => field.type === "member");
  const [title, setTitle] = useState("");
  const [values, setValues] = useState<CrmRecordFields["values"]>(() => {
    const initial: CrmRecordFields["values"] = {};
    const firstStage = stage?.options[0];
    if (stage && firstStage) {
      initial[stage.id] = [firstStage.id];
    }
    if (owner) {
      initial[owner.id] = [pubkey];
    }
    return initial;
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }
    createRecord(table, {
      rank: rankBetween(records.at(-1)?.rank),
      title: title.trim(),
      values,
    });
    onDone();
  };

  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>New {table.singular.toLowerCase()}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-title`}>{titleField(table).name}</Label>
        <Input
          autoComplete="off"
          autoFocus
          id={`${id}-title`}
          onChange={(event) => setTitle(event.target.value)}
          value={title}
        />
      </div>
      {fields.length > 0 && (
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
          {fields.map((field) => (
            <Fragment key={field.id}>
              <Label
                className="text-muted-foreground truncate font-normal"
                htmlFor={`${id}-${field.id}`}
              >
                {field.name}
              </Label>
              <FieldInput
                field={field}
                id={`${id}-${field.id}`}
                onChange={(next) => setValues({ ...values, [field.id]: next })}
                values={values[field.id] ?? []}
              />
            </Fragment>
          ))}
        </div>
      )}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="ghost" />}>
          Cancel
        </DialogClose>
        <Button disabled={!title.trim()} type="submit">
          Create {table.singular.toLowerCase()}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function NewRecordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent showCloseButton={false}>
        <NewRecordForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
