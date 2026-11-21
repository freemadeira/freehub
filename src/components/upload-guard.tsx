import { useEffect, useState } from "react";
import { useLocation } from "wouter";

import { appPath } from "@/components/app-link";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useUploadsWaiting } from "@/lib/image-uploads";

/**
 * While pictures are still uploading, links out of the page ask first:
 * leaving closes its editors, which stops them. So does closing the tab.
 */
export function UploadGuard({
  place,
}: {
  /** What's left, as the question names it: "post", "page", "card". */
  place: string;
}) {
  const [, navigate] = useLocation();
  const waiting = useUploadsWaiting();
  // Where a link was going when it was held back.
  const [leaving, setLeaving] = useState<string>();

  useEffect(() => {
    if (waiting === 0) {
      return;
    }
    const keep = (event: BeforeUnloadEvent) => event.preventDefault();
    const hold = (event: MouseEvent) => {
      const link =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      const path = link ? appPath(link.getAttribute("href") ?? "") : undefined;
      const plain =
        event.button === 0 &&
        !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
      if (
        !(link && path && plain) ||
        link.getAttribute("target") === "_blank" ||
        path === `${location.pathname}${location.search}`
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setLeaving(path);
    };
    addEventListener("beforeunload", keep);
    // Before the app's own handling of the link.
    document.addEventListener("click", hold, true);
    return () => {
      removeEventListener("beforeunload", keep);
      document.removeEventListener("click", hold, true);
    };
  }, [waiting]);

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          setLeaving(undefined);
        }
      }}
      open={leaving !== undefined}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Pictures are still uploading</AlertDialogTitle>
          <AlertDialogDescription>
            Leaving the {place} now stops them, and they won’t be in it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (leaving) {
                navigate(leaving);
              }
            }}
            variant="destructive"
          >
            Leave anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
