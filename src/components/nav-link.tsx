import type { LinkProps } from "wouter";
import { Link } from "wouter";

import { useSidebar } from "@/components/ui/sidebar";

/** A sidebar link. The mobile sheet covers the page, so it closes once a link is followed. */
export function NavLink(props: LinkProps) {
  const { setOpenMobile } = useSidebar();
  return (
    <Link
      {...props}
      onClick={(event) => {
        props.onClick?.(event);
        setOpenMobile(false);
      }}
    />
  );
}
