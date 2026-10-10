import { Link } from "wouter";

import { fileHref } from "@/features/drive/drive-context";
import { FileVisual } from "@/features/drive/drive-items";
import { FileIcon } from "@/features/drive/file-icon";
import type { DriveFile } from "@/lib/drive";
import type { Project } from "@/lib/project";
import { formatBytes } from "@/lib/utils";

/** Files lately opened or added in the project's Drive, as small tiles that open them. */
export function RecentFiles({
  project,
  files,
}: {
  project: Project;
  files: DriveFile[];
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {files.map((file) => (
        <Link
          className="bg-card shadow-surface hover:shadow-raised focus-visible:ring-ring/50 flex min-w-0 flex-col rounded-2xl p-1.5 transition-[box-shadow,scale] duration-150 ease-out outline-none focus-visible:ring-3 active:scale-[0.98]"
          href={fileHref(project, file)}
          key={file.id}
        >
          <FileVisual
            className="image-outline aspect-4/3 w-full rounded-xl"
            file={file}
          />
          <span className="flex min-w-0 items-center gap-1.5 px-1 pt-2">
            <FileIcon file={file} size="sm" />
            <span className="truncate text-sm font-medium" title={file.name}>
              {file.name}
            </span>
          </span>
          <span className="text-muted-foreground px-1 pb-0.5 text-xs">
            {formatBytes(file.size)}
          </span>
        </Link>
      ))}
    </div>
  );
}
