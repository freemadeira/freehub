/**
 * Sources are what connectors feed into tables, like a store's orders. A
 * connector describes each one in a manifest: its attributes and, for ones
 * with fixed values like an order's status, those values. The app builds its
 * mapping from the manifest, so a new kind of source needs no app change. No
 * browser APIs here, so the connector service reuses it.
 */
import type { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";

import type {
  Connection,
  CrmTableFields,
  Field,
  FieldType,
  StageKind,
} from "@/lib/crm";
import { CURRENCIES, shortId, STAGE_KINDS } from "@/lib/crm";
import type { Template } from "@/lib/model";
import { isDeleted, SOURCE_KIND } from "@/lib/model";
import type { Color } from "@/lib/palette";
import { parseColor } from "@/lib/palette";

/** Which field types each attribute type can fill, the best fit first. */
const COMPATIBLE = {
  currency: ["currency", "number"],
  date: ["date"],
  email: ["email", "text"],
  location: ["location"],
  longtext: ["longtext", "text"],
  number: ["number", "currency"],
  phone: ["phone", "text"],
  select: ["select", "stage"],
  stage: ["stage", "select"],
  text: ["text", "longtext"],
  title: ["title"],
  url: ["url", "text"],
} as const satisfies Record<string, readonly FieldType[]>;

export type AttributeType = keyof typeof COMPATIBLE;

const ATTRIBUTE_TYPES = Object.keys(COMPATIBLE) as AttributeType[];
const VALUE_TYPES: ReadonlySet<AttributeType> = new Set(["select", "stage"]);

export interface SourceValue {
  id: string;
  label: string;
  color: Color;
  /** Where a stage ends up, for stage attributes. */
  kind: StageKind;
}

export interface SourceAttribute {
  id: string;
  type: AttributeType;
  name: string;
  /** Currency code for currency attributes. */
  config: string;
  values: SourceValue[];
}

export interface SourceFields {
  id: string;
  /** Kind of source, like `shopify`. */
  type: string;
  name: string;
  attributes: SourceAttribute[];
}

export type Source = SourceFields & {
  /** The connector's pubkey. */
  connector: string;
  event: NostrEvent;
};

export function compatibleTypes(type: AttributeType): readonly FieldType[] {
  return COMPATIBLE[type];
}

export function canFill(attribute: SourceAttribute, field: Field): boolean {
  return compatibleTypes(attribute.type).includes(field.type);
}

/** Whether the attribute's values map onto the field's options. */
export function hasValues(attribute: SourceAttribute, field: Field): boolean {
  return (
    VALUE_TYPES.has(attribute.type) &&
    attribute.values.length > 0 &&
    (field.type === "select" || field.type === "stage")
  );
}

function attributeType(value: string | undefined): AttributeType | undefined {
  return ATTRIBUTE_TYPES.find((type) => type === value);
}

function parseAttributes(event: NostrEvent): SourceAttribute[] {
  const attributes: SourceAttribute[] = [];
  for (const [name, id, raw, label, config] of event.tags) {
    const type = name === "attr" ? attributeType(raw) : undefined;
    if (type && id && !attributes.some((attribute) => attribute.id === id)) {
      attributes.push({
        config: config ?? "",
        id,
        name: label?.trim() || id,
        type,
        values: [],
      });
    }
  }
  return attributes;
}

function addValues(attributes: SourceAttribute[], event: NostrEvent): void {
  for (const [name, attributeId, id, label, color, kind] of event.tags) {
    const attribute = attributes.find((item) => item.id === attributeId);
    if (
      name === "value" &&
      attribute &&
      VALUE_TYPES.has(attribute.type) &&
      id &&
      !attribute.values.some((value) => value.id === id)
    ) {
      attribute.values.push({
        color: parseColor(color),
        id,
        kind: STAGE_KINDS.find((item) => item === kind) ?? "open",
        label: label?.trim() || id,
      });
    }
  }
}

export function parseSource(event: NostrEvent): Source | undefined {
  const id = getTagValue(event, "d");
  if (event.kind !== SOURCE_KIND || !id || isDeleted(event)) {
    return undefined;
  }
  const attributes = parseAttributes(event);
  addValues(attributes, event);
  return {
    attributes,
    connector: event.pubkey,
    event,
    id,
    name: getTagValue(event, "name")?.trim() || id,
    type: getTagValue(event, "type") ?? "",
  };
}

export function sourceTemplate(source: SourceFields): Template {
  const tags = [
    ["d", source.id],
    ["name", source.name],
    ["type", source.type],
  ];
  for (const { id, type, name, config } of source.attributes) {
    tags.push(
      config ? ["attr", id, type, name, config] : ["attr", id, type, name]
    );
  }
  for (const attribute of source.attributes) {
    for (const value of attribute.values) {
      tags.push([
        "value",
        attribute.id,
        value.id,
        value.label,
        value.color,
        value.kind,
      ]);
    }
  }
  tags.push(["alt", `Connector source: ${source.name}`]);
  return { content: "", kind: SOURCE_KIND, tags };
}

export function sourceTombstoneTemplate(id: string): Template {
  return { content: "", kind: SOURCE_KIND, tags: [["d", id], ["deleted"]] };
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Each value of the attribute to the field's option with the same label. */
export function suggestOptions(
  attribute: SourceAttribute,
  field: Field
): Record<string, string> {
  if (!hasValues(attribute, field)) {
    return {};
  }
  return Object.fromEntries(
    attribute.values.flatMap((value) => {
      const option = field.options.find(({ label }) =>
        sameText(label, value.label)
      );
      return option ? [[value.id, option.id]] : [];
    })
  );
}

/** A first mapping for a source: fields with the same name and a fitting type. */
export function suggestConnection(
  source: Source,
  table: Pick<CrmTableFields, "fields">
): Connection {
  const fields: Record<string, string> = {};
  const options: Record<string, Record<string, string>> = {};
  const used = new Set<string>();
  for (const attribute of source.attributes) {
    const field = table.fields.find(
      (item) =>
        !used.has(item.id) &&
        canFill(attribute, item) &&
        (attribute.type === "title" || sameText(item.name, attribute.name))
    );
    if (field) {
      used.add(field.id);
      fields[attribute.id] = field.id;
      const mapped = suggestOptions(attribute, field);
      if (Object.keys(mapped).length > 0) {
        options[attribute.id] = mapped;
      }
    }
  }
  return { connector: source.connector, fields, options, source: source.id };
}

/**
 * A new field that holds the attribute. A stage attribute becomes the table's
 * stage, or a select when it already has one.
 */
export function fieldForAttribute(
  attribute: SourceAttribute,
  fields: readonly Field[]
): Field {
  let [type] = compatibleTypes(attribute.type) as [FieldType];
  let config = "";
  if (type === "stage" && fields.some((field) => field.type === "stage")) {
    type = "select";
  }
  if (type === "currency") {
    const currency = CURRENCIES.find((code) => code === attribute.config);
    // A currency the app doesn't show would read as euros, so keep the number.
    if (currency) {
      config = currency;
    } else {
      type = "number";
    }
  }
  return {
    config,
    id: shortId(),
    name: attribute.name,
    options: VALUE_TYPES.has(attribute.type)
      ? attribute.values.map((value) => ({
          color: value.color,
          id: shortId(),
          kind: type === "stage" ? value.kind : "open",
          label: value.label,
        }))
      : [],
    type,
  };
}
