import type { ReactNode } from "react";
import { Link } from "wouter";

import { ConnectionStatus } from "@/components/connection-status";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";

export interface Crumb {
  label: string;
  href?: string;
  icon?: ReactNode;
}

function Divider() {
  return (
    <span
      aria-hidden
      className="bg-foreground/15 h-5 w-px shrink-0 rotate-12 max-sm:hidden"
    />
  );
}

export function TopBar({
  crumbs,
  children,
}: {
  crumbs: Crumb[];
  children?: ReactNode;
}) {
  const { isMobile, open } = useSidebar();
  return (
    <header className="bg-background/85 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 px-4 backdrop-blur-md sm:px-6">
      {(isMobile || !open) && <SidebarTrigger className="-ml-1.5" />}
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex min-w-0 items-center gap-3">
          {crumbs.map((crumb, index) => (
            <li
              className="flex min-w-0 items-center gap-3 not-last:max-sm:hidden"
              key={crumb.href ?? crumb.label}
            >
              {index > 0 && <Divider />}
              {crumb.href ? (
                <Link
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-1.5 flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 transition-colors duration-150 outline-none focus-visible:ring-3"
                  href={crumb.href}
                >
                  {crumb.icon}
                  <span className="truncate">{crumb.label}</span>
                </Link>
              ) : (
                <h1
                  aria-current="page"
                  className="flex min-w-0 items-center gap-2 font-medium"
                >
                  {crumb.icon}
                  <span className="truncate">{crumb.label}</span>
                </h1>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {children}
        <ConnectionStatus />
      </div>
    </header>
  );
}
