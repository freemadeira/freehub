import { CloudOffIcon, RefreshCwIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { distinctUntilChanged, map, of, switchMap, timer } from "rxjs";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useObservableValue } from "@/hooks/use-observable-value";
import { unsynced$ } from "@/lib/publish";
import { access$ } from "@/lib/relays";
import { recheckSigner, signerState$ } from "@/lib/signer";
import { plural } from "@/lib/utils";

// Changes usually land within a second; only show syncing when they don't.
const SYNC_GRACE = 1000;

const syncing$ = unsynced$.pipe(
  map((size) => size > 0),
  distinctUntilChanged(),
  switchMap((busy) =>
    busy ? timer(SYNC_GRACE).pipe(map(() => true)) : of(false)
  )
);

function Pill({ children }: { children: ReactNode }) {
  return (
    <motion.span
      animate={{ filter: "blur(0px)", opacity: 1 }}
      className="text-muted-foreground flex h-8 items-center gap-1.5 rounded-full px-3 text-xs"
      exit={{ filter: "blur(4px)", opacity: 0, transition: { duration: 0.15 } }}
      initial={{ filter: "blur(4px)", opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
    >
      {children}
    </motion.span>
  );
}

export function ConnectionStatus() {
  const access = useObservableValue(access$);
  const signer = useObservableValue(signerState$);
  const pending = useObservableValue(unsynced$) ?? 0;
  const syncing = useObservableValue(syncing$);

  let status: ReactNode = null;
  if (access === "offline") {
    status = (
      <Pill key="offline">
        <CloudOffIcon className="size-4" />
        <span className="max-sm:sr-only">
          {pending > 0
            ? `Offline · ${plural(pending, "unsynced change")}`
            : "Offline"}
        </span>
      </Pill>
    );
  } else if (signer === "unreachable") {
    status = (
      <Pill key="signer">
        <Button
          className="text-muted-foreground -mx-3"
          onClick={() => recheckSigner()}
          size="sm"
          variant="ghost"
        >
          <RefreshCwIcon />
          <span className="max-sm:sr-only">Signer not responding</span>
        </Button>
      </Pill>
    );
  } else if (syncing && pending > 0) {
    status = (
      <Pill key="syncing">
        <Spinner />
        <span className="max-sm:sr-only">
          Syncing {plural(pending, "change")}
        </span>
      </Pill>
    );
  }

  return (
    <output className="flex">
      <AnimatePresence initial={false}>{status}</AnimatePresence>
    </output>
  );
}
