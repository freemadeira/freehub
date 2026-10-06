import { FileSpreadsheetIcon } from "lucide-react";
import type { ChangeEvent } from "react";
import { useId, useState } from "react";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCrm } from "@/features/crm/crm-context";
import { countLabel } from "@/features/crm/records-view";
import type { Field, FieldOption } from "@/lib/crm";
import { recordTitle, relationTarget, shortId, TITLE_FIELD } from "@/lib/crm";
import type { NewRecord } from "@/lib/crm-actions";
import { importRecords, updateTable } from "@/lib/crm-actions";
import type { CellContext } from "@/lib/crm-values";
import { parseCell } from "@/lib/crm-values";
import { parseCsv } from "@/lib/csv";
import { COLORS } from "@/lib/palette";

const MAX_ROWS = 500;
const SKIP = "skip";
const TITLE_ALIASES = new Set(["name", "title", "business", "company"]);

interface Parsed {
  name: string;
  headers: string[];
  rows: string[][];
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "");
}

/** Pairs CSV columns with fields of the same name; the title falls back to a likely column. */
function guessMapping(headers: string[], fields: Field[]): string[] {
  const used = new Set<string>();
  const mapping = headers.map((header) => {
    const field = fields.find(
      (item) => !used.has(item.id) && normalize(item.name) === normalize(header)
    );
    if (field) {
      used.add(field.id);
      return field.id;
    }
    return SKIP;
  });
  if (!used.has(TITLE_FIELD)) {
    const index = headers.findIndex(
      (header, position) =>
        mapping[position] === SKIP && TITLE_ALIASES.has(normalize(header))
    );
    mapping[index === -1 ? mapping.indexOf(SKIP) : index] = TITLE_FIELD;
  }
  return mapping;
}

function ColumnRow({
  header,
  sample,
  value,
  fields,
  onChange,
}: {
  header: string;
  sample: string;
  value: string;
  fields: Field[];
  onChange: (value: string) => void;
}) {
  const options = [
    { label: "Don’t import", value: SKIP },
    ...fields.map((field) => ({ label: field.name, value: field.id })),
  ];
  return (
    <tr className="border-t">
      <td className="max-w-40 py-2 pr-3">
        <span className="block truncate font-medium">
          {header || "Untitled column"}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {sample || "–"}
        </span>
      </td>
      <td className="py-2">
        <Select
          items={options}
          onValueChange={(next: string | null) => onChange(next ?? SKIP)}
          value={value}
        >
          <SelectTrigger aria-label={`Field for ${header}`} className="w-full">
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
      </td>
    </tr>
  );
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const id = useId();
  const { content, project, records, table } = useCrm();
  const [parsed, setParsed] = useState<Parsed>();
  const [mapping, setMapping] = useState<string[]>([]);
  const [progress, setProgress] = useState<number>();
  const busy = progress !== undefined;
  const rows = parsed?.rows.slice(0, MAX_ROWS) ?? [];
  const mapsTitle = mapping.includes(TITLE_FIELD);

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const [headers = [], ...body] = parseCsv(await file.text());
    setParsed({ headers, name: file.name, rows: body });
    setMapping(guessMapping(headers, table.fields));
  };

  const run = async () => {
    if (!parsed) {
      return;
    }
    // Labels that match no option become new options, added to the table first.
    const fields = table.fields.map((field) => ({
      ...field,
      options: [...field.options],
    }));
    const added = new Set<string>();
    const context: CellContext = {
      option: (field, label) => {
        const target = fields.find((item) => item.id === field.id);
        const existing = target?.options.find(
          (option) => normalize(option.label) === normalize(label)
        );
        if (existing || !target) {
          return existing?.id ?? "";
        }
        const option: FieldOption = {
          color: COLORS[(target.options.length + 1) % COLORS.length] ?? "gray",
          id: shortId(),
          kind: "open",
          label: label.trim(),
        };
        target.options.push(option);
        added.add(field.id);
        return option.id;
      },
      relation: (field, title) => {
        const target = relationTarget(field, content);
        return (target ? (content.byTable.get(target.id) ?? []) : []).find(
          (record) => normalize(recordTitle(record)) === normalize(title)
        )?.id;
      },
    };
    const base = records.at(-1)?.rank ?? 0;
    const drafts: NewRecord[] = rows.map((row, index) => {
      const values: NonNullable<NewRecord["values"]> = {};
      let title = "";
      for (const [column, target] of mapping.entries()) {
        const raw = row[column] ?? "";
        const field = fields.find((item) => item.id === target);
        if (target === TITLE_FIELD) {
          title = raw.trim();
        } else if (field) {
          const parsedValues = parseCell(field, raw, context);
          if (parsedValues.length > 0) {
            values[field.id] = parsedValues;
          }
        }
      }
      return { rank: base + index + 1, title, values };
    });
    setProgress(0);
    if (added.size > 0 && !(await updateTable(project, table, { fields }))) {
      setProgress(undefined);
      return;
    }
    const saved = await importRecords(table, drafts, setProgress);
    setProgress(undefined);
    onDone();
    if (saved > 0) {
      toast.success(`Imported ${countLabel(table, saved)}`);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Import {table.title.toLowerCase()}</DialogTitle>
        <DialogDescription>
          From a CSV file whose first row names the columns. Each row becomes
          one {table.singular.toLowerCase()}.
        </DialogDescription>
      </DialogHeader>

      <label
        className="border-input hover:bg-foreground/[0.03] focus-within:ring-ring/50 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed p-4 transition-colors duration-150 focus-within:ring-3"
        htmlFor={`${id}-file`}
      >
        <FileSpreadsheetIcon
          aria-hidden
          className="text-muted-foreground size-6 shrink-0"
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">
            {parsed ? parsed.name : "Choose a CSV file"}
          </span>
          <span className="text-muted-foreground text-xs">
            {parsed
              ? `${parsed.rows.length} rows${parsed.rows.length > MAX_ROWS ? `, the first ${MAX_ROWS} are imported` : ""}`
              : "Exported from a spreadsheet or another CRM"}
          </span>
        </span>
        <input
          accept=".csv,text/csv"
          className="sr-only"
          disabled={busy}
          id={`${id}-file`}
          onChange={choose}
          type="file"
        />
      </label>

      {parsed && parsed.headers.length > 0 && (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-xs">
              <tr>
                <th className="pb-2 text-left font-medium">Column</th>
                <th className="pb-2 text-left font-medium">Imports into</th>
              </tr>
            </thead>
            <tbody>
              {parsed.headers.map((header, column) => (
                <ColumnRow
                  fields={table.fields}
                  header={header}
                  // Columns are positional and never reorder.
                  // oxlint-disable-next-line react/no-array-index-key
                  key={column}
                  onChange={(next) =>
                    setMapping(
                      mapping.map((item, position) =>
                        position === column ? next : item
                      )
                    )
                  }
                  sample={
                    rows.find((row) => row[column]?.trim())?.[column] ?? ""
                  }
                  value={mapping[column] ?? SKIP}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {progress !== undefined && (
        <div className="flex flex-col gap-1.5">
          <div className="bg-foreground/8 h-1.5 overflow-hidden rounded-full">
            <div
              className="bg-foreground/70 h-full rounded-full transition-[width] duration-200 ease-out"
              style={{
                width: `${(progress / Math.max(1, rows.length)) * 100}%`,
              }}
            />
          </div>
          <p className="text-muted-foreground text-xs tabular-nums">
            Saved {progress} of {rows.length}. Your signer may ask to approve
            each one.
          </p>
        </div>
      )}

      <DialogFooter>
        <DialogClose
          disabled={busy}
          render={<Button type="button" variant="ghost" />}
        >
          Cancel
        </DialogClose>
        <Button
          disabled={!(parsed && rows.length > 0 && mapsTitle) || busy}
          onClick={run}
        >
          {rows.length > 0
            ? `Import ${countLabel(table, rows.length)}`
            : "Import"}
        </Button>
      </DialogFooter>
      {parsed && rows.length > 0 && !mapsTitle && (
        <p className="text-destructive -mt-3 text-right text-xs" role="alert">
          Pick the column that holds the{" "}
          {table.fields[0]?.name.toLowerCase() ?? "name"}.
        </p>
      )}
    </div>
  );
}

export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-xl" showCloseButton={false}>
        <ImportForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
