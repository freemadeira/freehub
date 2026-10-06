import {
  npubEncode,
  normalizeToPubkey,
} from "applesauce-core/helpers/pointers";
import { format, isValid, parse, parseISO } from "date-fns";

import type { CrmRecord, Field } from "@/lib/crm";
import { findOption } from "@/lib/crm";

const DATE_FORMATS = [
  "dd/MM/yyyy",
  "d/M/yyyy",
  "dd.MM.yyyy",
  "d.M.yyyy",
  "MMM d, yyyy",
  "d MMM yyyy",
];
const TRUE = /^(?:true|yes|y|1|x|✓|sim|si|oui|ja)$/iu;
const LIST_SEPARATOR = /\s*[;,]\s*/u;

const plainNumber = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});
const wholeNumber = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});
const bitcoin = new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 });

export function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function formatNumber(value: number): string {
  return plainNumber.format(value);
}

export function formatCurrency(value: number, currency: string): string {
  if (currency === "SATS") {
    return `${wholeNumber.format(value)} sats`;
  }
  if (currency === "BTC") {
    return `₿${bitcoin.format(value)}`;
  }
  // Whole amounts read cleaner without cents.
  const digits = Number.isInteger(value) ? 0 : 2;
  try {
    return new Intl.NumberFormat(undefined, {
      currency,
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
      style: "currency",
    }).format(value);
  } catch {
    return `${plainNumber.format(value)} ${currency}`;
  }
}

export function formatDay(value: string, pattern = "MMM d, yyyy"): string {
  const day = parseISO(value);
  return isValid(day) ? format(day, pattern) : value;
}

export function isChecked(values: string[] | undefined): boolean {
  return values?.[0] === "true";
}

/** A field's value as plain text, for search and CSV export. */
export function plainValue(
  field: Field,
  record: CrmRecord,
  titleOf: (id: string) => string | undefined
): string {
  const values = record.values[field.id] ?? [];
  switch (field.type) {
    case "title": {
      return record.title;
    }
    case "select":
    case "multiselect":
    case "stage": {
      return values
        .map((value) => findOption(field, value)?.label ?? value)
        .join("; ");
    }
    case "member": {
      return values.map((value) => npubEncode(value)).join("; ");
    }
    case "relation": {
      return values.map((value) => titleOf(value) ?? "").join("; ");
    }
    case "checkbox": {
      return isChecked(values) ? "Yes" : "";
    }
    default: {
      return values.join("; ");
    }
  }
}

function parseNumber(raw: string): string | undefined {
  let cleaned = raw.replaceAll(/[^\d.,-]/gu, "");
  const comma = cleaned.lastIndexOf(",");
  const dot = cleaned.lastIndexOf(".");
  // "1.234,56" and "1,234.56": the separator that comes last is the decimal one.
  cleaned =
    comma > dot
      ? cleaned.replaceAll(".", "").replace(",", ".")
      : cleaned.replaceAll(",", "");
  const value = toNumber(cleaned);
  return value === undefined ? undefined : String(value);
}

function parseDate(raw: string): string | undefined {
  const iso = parseISO(raw);
  if (isValid(iso)) {
    return format(iso, "yyyy-MM-dd");
  }
  for (const pattern of DATE_FORMATS) {
    const day = parse(raw, pattern, new Date());
    if (isValid(day)) {
      return format(day, "yyyy-MM-dd");
    }
  }
  return undefined;
}

export interface CellContext {
  /** Option id for a label, creating the option when it doesn't exist yet. */
  option: (field: Field, label: string) => string;
  /** Record id in the relation's target table with this title. */
  relation: (field: Field, title: string) => string | undefined;
}

/**
 * Turns typed or imported text into the values stored for a field. Without a
 * context, options and relations can’t be resolved and come back empty.
 */
export function parseCell(
  field: Field,
  raw: string,
  context?: CellContext
): string[] {
  const text = raw.trim();
  if (!text) {
    return [];
  }
  switch (field.type) {
    case "number":
    case "currency": {
      const value = parseNumber(text);
      return value === undefined ? [] : [value];
    }
    case "date": {
      const value = parseDate(text);
      return value ? [value] : [];
    }
    case "checkbox": {
      return TRUE.test(text) ? ["true"] : [];
    }
    case "select":
    case "stage": {
      return context ? [context.option(field, text)] : [];
    }
    case "multiselect": {
      const labels = text.split(LIST_SEPARATOR).filter(Boolean);
      return context
        ? [...new Set(labels.map((label) => context.option(field, label)))]
        : [];
    }
    case "member": {
      const pubkey = normalizeToPubkey(text.replace(/^nostr:/u, ""));
      return pubkey ? [pubkey] : [];
    }
    case "relation": {
      const id = context?.relation(field, text);
      return id ? [id] : [];
    }
    default: {
      return [text];
    }
  }
}
