import type { LucideIcon, LucideProps } from "lucide-react";
import {
  BitcoinIcon,
  BriefcaseIcon,
  Building2Icon,
  CalendarIcon,
  CoinsIcon,
  HandshakeIcon,
  HeartIcon,
  MapIcon,
  StarIcon,
  StoreIcon,
  Table2Icon,
  UsersIcon,
} from "lucide-react";

import type { TableIcon as TableIconName } from "@/lib/crm";

export const TABLE_ICON_COMPONENTS: Record<TableIconName, LucideIcon> = {
  bitcoin: BitcoinIcon,
  briefcase: BriefcaseIcon,
  building: Building2Icon,
  calendar: CalendarIcon,
  coins: CoinsIcon,
  handshake: HandshakeIcon,
  heart: HeartIcon,
  map: MapIcon,
  star: StarIcon,
  store: StoreIcon,
  table: Table2Icon,
  users: UsersIcon,
};

export function TableIcon({
  icon,
  ...props
}: LucideProps & { icon: TableIconName }) {
  const Icon = TABLE_ICON_COMPONENTS[icon];
  return <Icon aria-hidden {...props} />;
}
