import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRightIcon,
  BanknoteIcon,
  CalendarIcon,
  CircleChevronDownIcon,
  HashIcon,
  LinkIcon,
  ListChecksIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  SignpostIcon,
  SquareCheckIcon,
  TextAlignStartIcon,
  TypeIcon,
  UserRoundIcon,
} from "lucide-react";

import type { FieldType } from "@/lib/crm";

interface FieldTypeMeta {
  label: string;
  icon: LucideIcon;
  hint: string;
}

export const FIELD_TYPE_META: Record<FieldType, FieldTypeMeta> = {
  checkbox: { hint: "Yes or no", icon: SquareCheckIcon, label: "Checkbox" },
  currency: {
    hint: "An amount of money",
    icon: BanknoteIcon,
    label: "Currency",
  },
  date: { hint: "A calendar day", icon: CalendarIcon, label: "Date" },
  email: { hint: "An email address", icon: MailIcon, label: "Email" },
  location: {
    hint: "A place on the map",
    icon: MapPinIcon,
    label: "Location",
  },
  longtext: {
    hint: "Several lines of text",
    icon: TextAlignStartIcon,
    label: "Long text",
  },
  member: {
    hint: "Someone on the project",
    icon: UserRoundIcon,
    label: "Member",
  },
  multiselect: {
    hint: "Several options from a list",
    icon: ListChecksIcon,
    label: "Multi-select",
  },
  number: { hint: "A number", icon: HashIcon, label: "Number" },
  phone: { hint: "A phone number", icon: PhoneIcon, label: "Phone" },
  relation: {
    hint: "A record in another table",
    icon: ArrowUpRightIcon,
    label: "Relation",
  },
  select: {
    hint: "One option from a list",
    icon: CircleChevronDownIcon,
    label: "Select",
  },
  stage: {
    hint: "Pipeline steps, with won and lost endings",
    icon: SignpostIcon,
    label: "Stage",
  },
  text: { hint: "A short line of text", icon: TypeIcon, label: "Text" },
  title: { hint: "What each record is called", icon: TypeIcon, label: "Title" },
  url: { hint: "A web address", icon: LinkIcon, label: "Link" },
};

/** Types offered when adding a field; the title field comes with every table. */
export const ADDABLE_TYPES: FieldType[] = [
  "text",
  "longtext",
  "number",
  "currency",
  "select",
  "multiselect",
  "stage",
  "date",
  "checkbox",
  "email",
  "phone",
  "url",
  "location",
  "member",
  "relation",
];

export const OPTION_TYPES = new Set<FieldType>([
  "select",
  "multiselect",
  "stage",
]);
