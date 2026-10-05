import { cn } from "cn";

import { getConfig } from "@/config";

export function Logo({ className }: { className?: string }) {
  const { name, logo, logoDark } = getConfig();
  if (logo === logoDark) {
    return (
      <img
        alt={name}
        className={cn("w-auto", className)}
        draggable={false}
        src={logo}
      />
    );
  }
  return (
    <>
      <img
        alt={name}
        className={cn("w-auto dark:hidden", className)}
        draggable={false}
        src={logo}
      />
      <img
        alt={name}
        className={cn("hidden w-auto dark:block", className)}
        draggable={false}
        src={logoDark}
      />
    </>
  );
}
