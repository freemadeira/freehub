import { map, of } from "rxjs";

import { useObservableValue } from "@/hooks/use-observable-value";
import type { DriveContent, DriveFile, DriveTree } from "@/lib/drive";
import {
  EMPTY_DRIVE,
  fileCommentAddresses,
  resolveDrive,
  resolveTree,
} from "@/lib/drive";
import type { DriveMarks } from "@/lib/drive-marks";
import { driveMarks } from "@/lib/drive-marks";
import type { Comment } from "@/lib/model";
import {
  COMMENT_KIND,
  DELETE_KIND,
  DRIVE_FILE_KIND,
  DRIVE_FOLDER_KIND,
  parseComment,
} from "@/lib/model";
import { eventStore } from "@/lib/nostr";
import type { Project } from "@/lib/project";
import { addressFilters, sync, whileLoading } from "@/lib/relays";

const FOLDERS = [DRIVE_FOLDER_KIND];
const KINDS = [DRIVE_FOLDER_KIND, DRIVE_FILE_KIND];
const NO_MARKS: DriveMarks = { opens: [], stars: new Set() };

/** Every project's Drive folders out of the trash, keyed by project address, for navigation. */
export function useDriveTrees(projects: Project[]): Map<string, DriveTree> {
  const addresses = projects.map((project) => project.address);
  const key = projects.map((project) => project.event.id).join(",");
  const members = [...new Set(projects.flatMap((project) => project.members))];
  const filters = [{ "#a": addresses, kinds: FOLDERS }];
  useObservableValue(
    () =>
      addresses.length > 0
        ? sync(addressFilters("#a", addresses, { kinds: FOLDERS }, members))
        : undefined,
    [key]
  );
  const trees = useObservableValue(
    () =>
      addresses.length > 0
        ? eventStore
            .timeline(filters)
            .pipe(
              map(
                (events) =>
                  new Map(
                    projects.map((project) => [
                      project.address,
                      resolveTree(project, events),
                    ])
                  )
              )
            )
        : of(new Map<string, DriveTree>()),
    [key]
  );
  return trees ?? new Map();
}

/** One project's Drive, folders and files, resolved across every member's versions. */
export function useDriveContent(project: Project): {
  content: DriveContent;
  loaded: boolean;
} {
  const filters = [{ "#a": [project.address], kinds: KINDS }];
  const feed = () =>
    sync(
      addressFilters("#a", [project.address], { kinds: KINDS }, project.members)
    );
  const loaded = useObservableValue(feed, [
    project.address,
    project.members.join(","),
  ]);
  const content = useObservableValue(
    () =>
      whileLoading(eventStore.timeline(filters), feed()).pipe(
        map((events) => resolveDrive(project, events))
      ),
    [project.address, project.event.id]
  );
  return { content: content ?? EMPTY_DRIVE, loaded: loaded ?? false };
}

/** What the person starred in the project's Drive, and the files they opened lately. */
export function useDriveMarks(pubkey: string, project: Project): DriveMarks {
  return (
    useObservableValue(
      () => driveMarks(pubkey, project.address).marks$,
      [pubkey, project.address]
    ) ?? NO_MARKS
  );
}

/** Comments on a file, oldest first. */
export function useFileComments(project: Project, file: DriveFile): Comment[] {
  const addresses = fileCommentAddresses(project, file);
  const filters = [{ "#A": addresses, kinds: [COMMENT_KIND] }];
  const key = `${project.event.id}:${file.id}`;
  useObservableValue(
    () =>
      sync(
        addressFilters(
          "#A",
          addresses,
          { "#K": [String(DRIVE_FILE_KIND)], kinds: [COMMENT_KIND] },
          project.members
        )
      ),
    [key]
  );
  const comments = useObservableValue(
    () =>
      eventStore.timeline(filters).pipe(
        map((events) =>
          events
            .filter((event) => project.members.includes(event.pubkey))
            .map(parseComment)
            .toReversed()
        )
      ),
    [key]
  );
  const ids =
    comments?.flatMap((comment) => (comment.event.sig ? [comment.id] : [])) ??
    [];
  useObservableValue(
    () =>
      ids.length > 0 ? sync([{ "#e": ids, kinds: [DELETE_KIND] }]) : undefined,
    [ids.join(",")]
  );
  return comments ?? [];
}
