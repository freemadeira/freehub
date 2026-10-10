import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { Connection, Field, FieldOption } from "@/lib/crm";
import { findConnection, shortId } from "@/lib/crm";
import type { Source, SourceAttribute, SourceValue } from "@/lib/sources";
import {
  canFill,
  fieldForAttribute,
  hasValues,
  suggestConnection,
} from "@/lib/sources";

const NONE = "none";

function without<T>(
  record: Readonly<Record<string, T>>,
  key: string
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([item]) => item !== key)
  );
}

export interface ConnectionsState {
  fields: Field[];
  connectors: string[];
  connections: Connection[];
}

interface ConnectionsEditorProps extends ConnectionsState {
  sources: Source[];
  onChange: (next: ConnectionsState) => void;
}

function MappingSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
}) {
  const items = [{ label: "Not used", value: NONE }, ...options];
  const current = options.some((option) => option.value === value)
    ? value
    : NONE;
  return (
    <Select
      items={items}
      onValueChange={(next: string | null) =>
        onChange(next && next !== NONE ? next : undefined)
      }
      value={current}
    >
      <SelectTrigger aria-label={label} className="h-8 w-40 shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function newOption(value: SourceValue, field: Field): FieldOption {
  return {
    color: value.color,
    id: shortId(),
    kind: field.type === "stage" ? value.kind : "open",
    label: value.label,
  };
}

function mappedField(
  attribute: SourceAttribute,
  connection: Connection,
  fields: readonly Field[]
): Field | undefined {
  const field = fields.find(({ id }) => id === connection.fields[attribute.id]);
  return field && canFill(attribute, field) ? field : undefined;
}

// Values of the attribute that no option of its field takes yet.
function unmappedValues(
  attribute: SourceAttribute,
  connection: Connection,
  field: Field
): SourceValue[] {
  if (!hasValues(attribute, field)) {
    return [];
  }
  const options = connection.options[attribute.id] ?? {};
  return attribute.values.filter((value) =>
    field.options.every(({ id }) => id !== options[value.id])
  );
}

/** Fields and options for what the source sends but the table can't hold yet. */
function addMissing(
  source: Source,
  connection: Connection,
  fields: Field[]
): { fields: Field[]; connection: Connection } {
  let next = [...fields];
  const mapping = { ...connection.fields };
  const options = { ...connection.options };
  for (const attribute of source.attributes) {
    let field = mappedField(attribute, connection, next);
    if (!field && attribute.type === "title") {
      // Every table has its one title field already.
      field = next.find((item) => item.type === "title");
      if (field) {
        mapping[attribute.id] = field.id;
      }
    }
    if (!field) {
      field = { ...fieldForAttribute(attribute, next), options: [] };
      next.push(field);
      mapping[attribute.id] = field.id;
    }
    const missing = unmappedValues(
      attribute,
      { ...connection, fields: mapping, options },
      field
    );
    if (missing.length > 0) {
      const added = missing.map((value) => ({
        option: newOption(value, field),
        value,
      }));
      const { id } = field;
      next = next.map((item) =>
        item.id === id
          ? {
              ...item,
              options: [...item.options, ...added.map(({ option }) => option)],
            }
          : item
      );
      options[attribute.id] = {
        ...options[attribute.id],
        ...Object.fromEntries(
          added.map(({ option, value }) => [value.id, option.id])
        ),
      };
    }
  }
  return {
    connection: { ...connection, fields: mapping, options },
    fields: next,
  };
}

function missingWhat(
  source: Source,
  connection: Connection,
  fields: readonly Field[]
): "fields" | "options" | undefined {
  let options = false;
  for (const attribute of source.attributes) {
    const field = mappedField(attribute, connection, fields);
    if (!field) {
      return "fields";
    }
    options ||= unmappedValues(attribute, connection, field).length > 0;
  }
  return options ? "options" : undefined;
}

function AttributeRow({
  attribute,
  connection,
  fields,
  onChange,
}: {
  attribute: SourceAttribute;
  connection: Connection;
  fields: Field[];
  onChange: (connection: Connection) => void;
}) {
  const field = mappedField(attribute, connection, fields);
  const values = field && hasValues(attribute, field) ? attribute.values : [];
  const options = connection.options[attribute.id] ?? {};
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">
          {attribute.name}
        </span>
        <MappingSelect
          label={`Field for ${attribute.name}`}
          onChange={(id) => {
            const rest = without(connection.fields, attribute.id);
            onChange({
              ...connection,
              fields: id ? { ...rest, [attribute.id]: id } : rest,
              options: without(connection.options, attribute.id),
            });
          }}
          options={fields
            .filter((item) => canFill(attribute, item))
            .map((item) => ({ label: item.name, value: item.id }))}
          value={field?.id}
        />
      </div>
      {field && values.length > 0 && (
        <ul className="flex flex-col gap-1.5 pl-4">
          {values.map((value) => (
            <li className="flex items-center gap-2" key={value.id}>
              <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                {value.label}
              </span>
              <MappingSelect
                label={`${field.name} option for ${value.label}`}
                onChange={(option) => {
                  const rest = without(options, value.id);
                  onChange({
                    ...connection,
                    options: {
                      ...connection.options,
                      [attribute.id]: option
                        ? { ...rest, [value.id]: option }
                        : rest,
                    },
                  });
                }}
                options={field.options.map((option) => ({
                  label: option.label,
                  value: option.id,
                }))}
                value={options[value.id]}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function SourceRow({
  source,
  name,
  connection,
  state,
  onChange,
}: {
  source: Source | undefined;
  name: string;
  connection: Connection | undefined;
  state: ConnectionsState;
  onChange: (next: ConnectionsState) => void;
}) {
  // The connection changed in place, or switched off without one.
  const replace = (next?: Connection, fields?: Field[]) =>
    onChange({
      ...state,
      connections: next
        ? state.connections.map((item) => (item === connection ? next : item))
        : state.connections.filter((item) => item !== connection),
      fields: fields ?? state.fields,
    });
  const missing =
    source && connection
      ? missingWhat(source, connection, state.fields)
      : undefined;
  return (
    <li className="bg-card shadow-surface flex flex-col gap-3 rounded-xl p-3">
      <label className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {name}
        </span>
        <Switch
          checked={connection !== undefined}
          disabled={!(source || connection)}
          onCheckedChange={(on) => {
            if (!on) {
              replace();
            } else if (source) {
              onChange({
                ...state,
                connections: [
                  ...state.connections,
                  suggestConnection(source, state),
                ],
                connectors: state.connectors.includes(source.connector)
                  ? state.connectors
                  : [...state.connectors, source.connector],
              });
            }
          }}
        />
      </label>
      {source && connection && (
        <>
          <ul className="flex flex-col gap-1.5">
            {source.attributes.map((attribute) => (
              <AttributeRow
                attribute={attribute}
                connection={connection}
                fields={state.fields}
                key={attribute.id}
                onChange={(next) => replace(next)}
              />
            ))}
          </ul>
          {missing && (
            <Button
              className="self-start"
              onClick={() => {
                const added = addMissing(source, connection, state.fields);
                replace(added.connection, added.fields);
              }}
              type="button"
              variant="outline"
            >
              <PlusIcon />
              {missing === "fields"
                ? "Add missing fields"
                : "Add missing options"}
            </Button>
          )}
        </>
      )}
    </li>
  );
}

/** Sources switched on for the table, and which fields their data fills. */
export function ConnectionsEditor({
  sources,
  onChange,
  ...state
}: ConnectionsEditorProps) {
  // Connections whose source no longer describes itself can still be switched off.
  const orphans = state.connections.filter(
    (connection) =>
      !sources.some(
        (source) =>
          source.connector === connection.connector &&
          source.id === connection.source
      )
  );
  if (sources.length === 0 && orphans.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Connections</h3>
      <ul className="flex flex-col gap-1.5">
        {sources.map((source) => (
          <SourceRow
            connection={findConnection(state, source.connector, source.id)}
            key={`${source.connector}:${source.id}`}
            name={source.name}
            onChange={onChange}
            source={source}
            state={state}
          />
        ))}
        {orphans.map((connection) => (
          <SourceRow
            connection={connection}
            key={`${connection.connector}:${connection.source}`}
            name={connection.source}
            onChange={onChange}
            source={undefined}
            state={state}
          />
        ))}
      </ul>
    </div>
  );
}
