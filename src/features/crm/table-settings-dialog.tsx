import { cn } from "cn";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import type { FormEvent } from "react";
import { useId, useRef, useState } from "react";
import { useLocation } from "wouter";

import { IconButton } from "@/components/icon-button";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ConnectionsState } from "@/features/crm/connections-editor";
import { ConnectionsEditor } from "@/features/crm/connections-editor";
import { useCrm } from "@/features/crm/crm-context";
import {
  ADDABLE_TYPES,
  FIELD_TYPE_META,
  OPTION_TYPES,
} from "@/features/crm/field-meta";
import { OptionsEditor, swap } from "@/features/crm/options-editor";
import { TABLE_ICON_COMPONENTS } from "@/features/crm/table-icon";
import { useSources } from "@/hooks/use-sources";
import type { CrmTable, Field, FieldType, TableIcon } from "@/lib/crm";
import {
  CURRENCIES,
  mergeConnections,
  mergeConnectors,
  mergeFields,
  pruneConnections,
  shortId,
  TABLE_ICONS,
} from "@/lib/crm";
import { deleteTable, updateTable } from "@/lib/crm-actions";

function newField(
  type: FieldType,
  tables: CrmTable[],
  current: CrmTable
): Field {
  const other = tables.find((table) => table.id !== current.id) ?? current;
  let config = "";
  if (type === "currency") {
    config = "EUR";
  } else if (type === "relation") {
    config = other.id;
  }
  return {
    config,
    id: shortId(),
    name: type === "relation" ? other.singular : FIELD_TYPE_META[type].label,
    options: [],
    type,
  };
}

function ConfigSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      items={options}
      onValueChange={(next: string | null) => {
        if (next) {
          onChange(next);
        }
      }}
      value={value}
    >
      <SelectTrigger aria-label={label} className="h-8 w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface FieldRowProps {
  field: Field;
  index: number;
  count: number;
  onChange: (field: Field) => void;
  onMove: (offset: number) => void;
  onRemove: () => void;
}

function FieldRow({
  field,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: FieldRowProps) {
  const { content } = useCrm();
  const [expanded, setExpanded] = useState(false);
  const meta = FIELD_TYPE_META[field.type];
  const Icon = meta.icon;
  const isTitle = field.type === "title";
  const hasOptions = OPTION_TYPES.has(field.type);

  return (
    <li className="bg-card shadow-surface flex flex-col gap-2 rounded-xl p-2">
      <div className="flex items-center gap-1.5">
        {hasOptions ? (
          <IconButton
            aria-expanded={expanded}
            className="[&_svg]:transition-transform [&_svg]:duration-200 aria-expanded:[&_svg]:rotate-90"
            label={expanded ? "Hide options" : "Show options"}
            onClick={() => setExpanded(!expanded)}
          >
            <ChevronRightIcon />
          </IconButton>
        ) : (
          <span className="text-muted-foreground flex size-8 shrink-0 items-center justify-center">
            <Icon aria-hidden className="size-4" />
          </span>
        )}
        <input
          aria-label={`${meta.label} field name`}
          className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/30 dark:bg-input/30 h-8 min-w-0 flex-1 rounded-lg border px-2.5 text-base outline-none focus-visible:ring-3 md:text-sm"
          onChange={(event) => onChange({ ...field, name: event.target.value })}
          value={field.name}
        />
        <span className="text-muted-foreground w-24 shrink-0 truncate text-xs max-sm:hidden">
          {hasOptions ? `${meta.label} · ${field.options.length}` : meta.label}
        </span>
        {field.type === "currency" && (
          <ConfigSelect
            label="Currency"
            onChange={(config) => onChange({ ...field, config })}
            options={CURRENCIES.map((code) => ({
              label: code === "SATS" ? "sats" : code,
              value: code,
            }))}
            value={field.config || "EUR"}
          />
        )}
        {field.type === "relation" && (
          <ConfigSelect
            label="Linked table"
            onChange={(config) => onChange({ ...field, config })}
            options={content.tables.map((table) => ({
              label: table.title,
              value: table.id,
            }))}
            value={field.config}
          />
        )}
        {!isTitle && (
          <>
            <div className="flex shrink-0 items-center max-sm:hidden">
              <IconButton
                disabled={index <= 1}
                label="Move up"
                onClick={() => onMove(-1)}
                size="icon-xs"
              >
                <ArrowUpIcon />
              </IconButton>
              <IconButton
                disabled={index === count - 1}
                label="Move down"
                onClick={() => onMove(1)}
                size="icon-xs"
              >
                <ArrowDownIcon />
              </IconButton>
            </div>
            <IconButton
              label={`Remove ${field.name}`}
              onClick={onRemove}
              size="icon-xs"
            >
              <XIcon />
            </IconButton>
          </>
        )}
      </div>
      {hasOptions && expanded && (
        <div className="pl-9">
          <OptionsEditor
            field={field}
            onChange={(options) => onChange({ ...field, options })}
          />
        </div>
      )}
    </li>
  );
}

function AddField({
  fields,
  onAdd,
}: {
  fields: Field[];
  onAdd: (type: FieldType) => void;
}) {
  const hasStage = fields.some((field) => field.type === "stage");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button className="self-start" type="button" variant="outline" />
        }
      >
        <PlusIcon />
        Add field
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-72">
        {ADDABLE_TYPES.filter((type) => type !== "stage" || !hasStage).map(
          (type) => {
            const { icon: Icon, label, hint } = FIELD_TYPE_META[type];
            return (
              <DropdownMenuItem
                className="items-start"
                key={type}
                onClick={() => onAdd(type)}
              >
                <Icon className="text-muted-foreground mt-0.5" />
                <span className="flex flex-col">
                  <span>{label}</span>
                  <span className="text-muted-foreground text-xs">{hint}</span>
                </span>
              </DropdownMenuItem>
            );
          }
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeleteTable({ onDeleted }: { onDeleted: () => void }) {
  const { project, records, table } = useCrm();
  const [, navigate] = useLocation();
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button className="sm:mr-auto" type="button" variant="destructive" />
        }
      >
        Delete table
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {table.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            {records.length === 0
              ? "It disappears for everyone in the project."
              : `It disappears for everyone, along with its ${records.length} ${(records.length === 1 ? table.singular : table.title).toLowerCase()}.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              deleteTable(project, table);
              onDeleted();
              navigate(`/p/${project.slug}`, { replace: true });
            }}
            variant="destructive"
          >
            Delete table
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function TableSettingsForm({ onDone }: { onDone: () => void }) {
  const id = useId();
  const { content, project, table } = useCrm();
  // The table as the dialog opened; only what changed since is saved over the latest one.
  const opened = useRef(table);
  const [title, setTitle] = useState(table.title);
  const [singular, setSingular] = useState(table.singular);
  const [description, setDescription] = useState(table.description);
  const [icon, setIcon] = useState<TableIcon>(table.icon);
  const [fields, setFields] = useState(table.fields);
  const [connectors, setConnectors] = useState(table.connectors);
  const [connections, setConnections] = useState(table.connections);
  const sources = useSources(content);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const base = opened.current;
    const saved = mergeFields(base.fields, fields, table.fields).map(
      (field) => ({
        ...field,
        name: field.name.trim() || FIELD_TYPE_META[field.type].label,
        options: field.options.map((option) => ({
          ...option,
          label: option.label.trim() || "Untitled",
        })),
      })
    );
    updateTable(project, table, {
      connections: pruneConnections(
        mergeConnections(base.connections, connections, table.connections),
        saved
      ),
      connectors: mergeConnectors(
        base.connectors,
        connectors,
        table.connectors
      ),
      description:
        description === base.description
          ? table.description
          : description.trim(),
      fields: saved,
      icon: icon === base.icon ? table.icon : icon,
      singular:
        singular === base.singular
          ? table.singular
          : singular.trim() || table.singular,
      title: title === base.title ? table.title : title.trim() || table.title,
    });
    onDone();
  };

  const change = (next: Field) =>
    setFields(fields.map((field) => (field.id === next.id ? next : field)));

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Table settings</DialogTitle>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-title`}>Name</Label>
          <Input
            autoComplete="off"
            id={`${id}-title`}
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-singular`}>One of them is a</Label>
          <Input
            autoComplete="off"
            id={`${id}-singular`}
            onChange={(event) => setSingular(event.target.value)}
            value={singular}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium select-none" id={`${id}-icon`}>
          Icon
        </span>
        <ToggleGroup
          aria-labelledby={`${id}-icon`}
          className="flex-wrap gap-1"
          onValueChange={(next) => {
            const picked = TABLE_ICONS.find((item) => item === next[0]);
            if (picked) {
              setIcon(picked);
            }
          }}
          value={[icon]}
        >
          {TABLE_ICONS.map((name) => {
            const Icon = TABLE_ICON_COMPONENTS[name];
            return (
              <ToggleGroupItem
                aria-label={name}
                className={cn(
                  "text-muted-foreground hover:bg-foreground/5 hover:text-foreground data-pressed:bg-primary/15 data-pressed:text-foreground data-pressed:inset-ring-primary/60 flex size-9 items-center justify-center rounded-lg transition-[background-color,color,box-shadow] duration-150 data-pressed:inset-ring"
                )}
                key={name}
                value={name}
              >
                <Icon className="size-4" />
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-description`}>Description</Label>
        <Textarea
          className="min-h-16"
          id={`${id}-description`}
          onChange={(event) => setDescription(event.target.value)}
          value={description}
        />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Fields</h3>
        <FluidTooltip.Group>
          <ul className="flex flex-col gap-1.5">
            {fields.map((field, index) => (
              <FieldRow
                count={fields.length}
                field={field}
                index={index}
                key={field.id}
                onChange={change}
                onMove={(offset) => {
                  // The title field always stays first.
                  if (index + offset >= 1) {
                    setFields(swap(fields, index, offset));
                  }
                }}
                onRemove={() =>
                  setFields(fields.filter((item) => item.id !== field.id))
                }
              />
            ))}
          </ul>
        </FluidTooltip.Group>
        <AddField
          fields={fields}
          onAdd={(type) =>
            setFields([...fields, newField(type, content.tables, table)])
          }
        />
      </div>

      <ConnectionsEditor
        connections={connections}
        connectors={connectors}
        fields={fields}
        onChange={(next: ConnectionsState) => {
          setFields(next.fields);
          setConnectors(next.connectors);
          setConnections(next.connections);
        }}
        sources={sources}
      />

      <DialogFooter className="mt-1">
        <DeleteTable onDeleted={onDone} />
        <DialogClose render={<Button type="button" variant="ghost" />}>
          Cancel
        </DialogClose>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  );
}

export function TableSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-2xl" showCloseButton={false}>
        <TableSettingsForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
