import type { DriveFile, DriveFolder } from "@/lib/drive";
import type { Project } from "@/lib/project";
import { slugify } from "@/lib/project";

/** Where a project's Drive lives, after its tables: `/p/:project/drive`. */
export const DRIVE_SEGMENT = "drive";

/** The search parameter of the file open in the preview. */
export const FILE_PARAM = "file";
/** The search parameter of a view other than the folders: recent, starred or trash. */
export const VIEW_PARAM = "view";

export const VIEWS = ["recent", "starred", "trash"] as const;
export type DriveView = (typeof VIEWS)[number];

const FOLDER_ID = /(?:^|-)(?<id>[0-9a-f]{16})$/u;

/** The Drive's link, or a folder's: its name for people to read, then its id, which is what counts. */
export function drivePath(
  project: Pick<Project, "slug">,
  folder?: Pick<DriveFolder, "id" | "name">
): string {
  const base = `/p/${project.slug}/${DRIVE_SEGMENT}`;
  if (!folder) {
    return base;
  }
  const slug = slugify(folder.name);
  return `${base}/${slug ? `${slug}-` : ""}${folder.id}`;
}

/** The folder id at the end of a folder link, whatever name came before it. */
export function parseFolderParam(param: string): string | undefined {
  return FOLDER_ID.exec(param.toLowerCase())?.groups?.id;
}

/**
 * A link that opens the file in its folder. The folder's name only makes the
 * link readable; the Drive puts it right once it knows it.
 */
export function fileHref(
  project: Pick<Project, "slug">,
  file: Pick<DriveFile, "id" | "folder">,
  folder?: Pick<DriveFolder, "id" | "name">
): string {
  const place = file.folder
    ? drivePath(project, folder ?? { id: file.folder, name: "" })
    : drivePath(project);
  return `${place}?${FILE_PARAM}=${file.id}`;
}

export function parseView(value: string | null): DriveView | undefined {
  return VIEWS.find((view) => view === value);
}
