import {
  CornerUpRightIcon,
  FilePlusIcon,
  LinkIcon,
  Trash2Icon,
} from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import { copyText } from "@/components/copy";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  docsPath,
  pagePath,
  parsePageParam,
} from "@/features/docs/docs-context";
import { MovePageDialog } from "@/features/docs/move-page-dialog";
import type { DocPage, DocsContent } from "@/lib/docs";
import { descendants, pageTitle } from "@/lib/docs";
import { createPage, deletePage } from "@/lib/docs-actions";
import type { Project } from "@/lib/project";
import { plural } from "@/lib/utils";

interface PageMenuProps {
  project: Project;
  docs: DocsContent;
  page: DocPage;
  /** Whether the user is a member of the project; viewers can only copy the link. */
  canEdit: boolean;
  /** The button that opens the menu. */
  trigger: ReactElement;
  align?: "start" | "end";
}

/** What can be done to a page: add a page under it, copy its link, move or delete it. */
export function PageMenu({
  project,
  docs,
  page,
  canEdit,
  trigger,
  align = "end",
}: PageMenuProps) {
  const [path, navigate] = useLocation();
  const [dialog, setDialog] = useState<"move" | "delete">();
  const under = descendants(docs, page);

  const addPage = () => {
    const { id } = createPage(project, docs, { parent: page.id });
    navigate(pagePath(project, { id, title: "" }));
  };

  const copyLink = async () => {
    if (
      await copyText(`${globalThis.location.origin}${pagePath(project, page)}`)
    ) {
      toast.success("Link copied");
    }
  };

  const remove = () => {
    deletePage(project, docs, page);
    const open = parsePageParam(path.split("/").at(-1) ?? "");
    if (open && [page, ...under].some((item) => item.id === open)) {
      const parent = page.parent ? docs.byId.get(page.parent) : undefined;
      navigate(parent ? pagePath(project, parent) : docsPath(project), {
        replace: true,
      });
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger} />
        <DropdownMenuContent align={align}>
          {canEdit && (
            <DropdownMenuItem onClick={addPage}>
              <FilePlusIcon />
              Add a page inside
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={copyLink}>
            <LinkIcon />
            Copy link
          </DropdownMenuItem>
          {canEdit && (
            <>
              <DropdownMenuItem onClick={() => setDialog("move")}>
                <CornerUpRightIcon />
                Move to…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setDialog("delete")}
                variant="destructive"
              >
                <Trash2Icon />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <MovePageDialog
        docs={docs}
        onOpenChange={(open) => setDialog(open ? "move" : undefined)}
        open={dialog === "move"}
        page={page}
        project={project}
      />
      <AlertDialog
        onOpenChange={(open) => setDialog(open ? "delete" : undefined)}
        open={dialog === "delete"}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pageTitle(page)}?</AlertDialogTitle>
            <AlertDialogDescription>
              {under.length === 0
                ? "It disappears for everyone in the project."
                : `It disappears for everyone, along with the ${plural(under.length, "page")} inside it.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} variant="destructive">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
