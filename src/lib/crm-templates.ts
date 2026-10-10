import { unixNow } from "applesauce-core/helpers/time";

import type {
  CrmTableFields,
  Field,
  FieldOption,
  FieldType,
  StageKind,
  TableIcon,
} from "@/lib/crm";
import { RESERVED_TABLE_SLUGS, shortId, TITLE_FIELD } from "@/lib/crm";
import { newId } from "@/lib/model";
import type { Color } from "@/lib/palette";
import { slugify, uniqueSlug } from "@/lib/project";

type OptionSpec = [label: string, color: Color, kind?: StageKind];

interface FieldSpec {
  type: FieldType;
  name: string;
  options?: OptionSpec[];
  currency?: string;
  /** Key of another table in the same pack. */
  relation?: string;
}

interface TableSpec {
  key: string;
  title: string;
  singular: string;
  icon: TableIcon;
  description: string;
  name: string;
  fields: FieldSpec[];
}

export interface TablePack {
  id: string;
  title: string;
  description: string;
  icon: TableIcon;
  tables: TableSpec[];
}

const OWNER: FieldSpec = { name: "Owner", type: "member" };

export const MERCHANT_PACK: TablePack = {
  description:
    "Follow businesses from first visit to accepting bitcoin, with owners and follow-ups.",
  icon: "bitcoin",
  id: "merchants",
  tables: [
    {
      description: "Businesses on their way to accepting bitcoin.",
      fields: [
        {
          name: "Journey",
          options: [
            ["Lead", "gray"],
            ["Contacted", "blue"],
            ["Interested", "purple"],
            ["Onboarding", "orange"],
            ["Accepting bitcoin", "green", "won"],
            ["Not interested", "red", "lost"],
          ],
          type: "stage",
        },
        {
          name: "Category",
          options: [
            ["Café", "orange"],
            ["Restaurant", "red"],
            ["Bar", "purple"],
            ["Hotel", "blue"],
            ["Shop", "teal"],
            ["Services", "gray"],
            ["Tourism", "green"],
          ],
          type: "select",
        },
        OWNER,
        { name: "Location", type: "location" },
        { name: "Contact person", type: "text" },
        { name: "Phone", type: "phone" },
        { name: "Email", type: "email" },
        { name: "Website", type: "url" },
        {
          name: "Payment setup",
          options: [
            ["Lightning wallet", "yellow"],
            ["POS app", "blue"],
            ["Payment processor", "purple"],
            ["Online checkout", "teal"],
          ],
          type: "select",
        },
        { name: "On BTC Map", type: "checkbox" },
        { name: "Next follow-up", type: "date" },
        { name: "Accepting since", type: "date" },
      ],
      icon: "store",
      key: "merchants",
      name: "Business",
      singular: "Merchant",
      title: "Merchants",
    },
  ],
  title: "Merchant adoption",
};

export const TABLE_PACKS: TablePack[] = [
  MERCHANT_PACK,
  {
    description:
      "Companies, the people you talk to, and the deals moving through your pipeline.",
    icon: "handshake",
    id: "sales",
    tables: [
      {
        description: "Organizations you sell to.",
        fields: [
          {
            name: "Industry",
            options: [
              ["Software", "blue"],
              ["Retail", "teal"],
              ["Finance", "green"],
              ["Hospitality", "orange"],
              ["Other", "gray"],
            ],
            type: "select",
          },
          {
            name: "Size",
            options: [
              ["1–10", "gray"],
              ["11–50", "blue"],
              ["51–200", "purple"],
              ["200+", "pink"],
            ],
            type: "select",
          },
          { name: "Website", type: "url" },
          { name: "Location", type: "text" },
          OWNER,
        ],
        icon: "building",
        key: "companies",
        name: "Company",
        singular: "Company",
        title: "Companies",
      },
      {
        description: "Contacts at those companies.",
        fields: [
          { name: "Company", relation: "companies", type: "relation" },
          { name: "Role", type: "text" },
          { name: "Email", type: "email" },
          { name: "Phone", type: "phone" },
          OWNER,
        ],
        icon: "users",
        key: "people",
        name: "Name",
        singular: "Person",
        title: "People",
      },
      {
        description: "Opportunities from first call to signed.",
        fields: [
          {
            name: "Stage",
            options: [
              ["Qualified", "gray"],
              ["Discovery", "blue"],
              ["Proposal", "purple"],
              ["Negotiation", "orange"],
              ["Won", "green", "won"],
              ["Lost", "red", "lost"],
            ],
            type: "stage",
          },
          { currency: "EUR", name: "Value", type: "currency" },
          { name: "Company", relation: "companies", type: "relation" },
          { name: "Contact", relation: "people", type: "relation" },
          OWNER,
          { name: "Expected close", type: "date" },
          {
            name: "Source",
            options: [
              ["Inbound", "green"],
              ["Outbound", "blue"],
              ["Referral", "purple"],
              ["Event", "orange"],
            ],
            type: "select",
          },
        ],
        icon: "briefcase",
        key: "deals",
        name: "Deal",
        singular: "Deal",
        title: "Deals",
      },
    ],
    title: "Sales CRM",
  },
  {
    description: "A simple address book of people and organizations.",
    icon: "users",
    id: "contacts",
    tables: [
      {
        description: "People you keep in touch with.",
        fields: [
          {
            name: "Type",
            options: [
              ["Lead", "blue"],
              ["Customer", "green"],
              ["Partner", "purple"],
              ["Supplier", "orange"],
            ],
            type: "select",
          },
          { name: "Organization", type: "text" },
          { name: "Email", type: "email" },
          { name: "Phone", type: "phone" },
          { name: "Location", type: "text" },
          OWNER,
        ],
        icon: "users",
        key: "contacts",
        name: "Name",
        singular: "Contact",
        title: "Contacts",
      },
    ],
    title: "Contacts",
  },
  {
    description: "Start with just a name column and add your own fields.",
    icon: "table",
    id: "blank",
    tables: [
      {
        description: "",
        fields: [],
        icon: "table",
        key: "blank",
        name: "Name",
        singular: "Record",
        title: "Untitled",
      },
    ],
    title: "Blank table",
  },
];

function option([label, color, kind]: OptionSpec): FieldOption {
  return { color, id: shortId(), kind: kind ?? "open", label };
}

/**
 * Turns a pack into tables ready to publish. Relations point at the new ids,
 * and slugs avoid the ones the project already uses.
 */
export function buildPack(
  pack: TablePack,
  creator: string,
  takenSlugs: Iterable<string>,
  title?: string
): CrmTableFields[] {
  const taken = new Set([...RESERVED_TABLE_SLUGS, ...takenSlugs]);
  const ids = new Map(pack.tables.map((spec) => [spec.key, newId()]));
  const now = unixNow();
  return pack.tables.map((spec, index) => {
    const name = (pack.tables.length === 1 && title?.trim()) || spec.title;
    const slug = uniqueSlug(slugify(name), taken);
    taken.add(slug);
    const fields: Field[] = [
      {
        config: "",
        id: TITLE_FIELD,
        name: spec.name,
        options: [],
        type: "title",
      },
      ...spec.fields.map((field) => ({
        config: field.relation
          ? (ids.get(field.relation) ?? "")
          : (field.currency ?? ""),
        id: shortId(),
        name: field.name,
        options: (field.options ?? []).map(option),
        type: field.type,
      })),
    ];
    return {
      connections: [],
      connectors: [],
      createdAt: now + index,
      creator,
      description: spec.description,
      fields,
      icon: spec.icon,
      id: ids.get(spec.key) ?? newId(),
      singular: spec.singular,
      slug,
      title: name,
    };
  });
}
