import { useEveryBoard } from "@/hooks/use-boards";
import { useEveryProject } from "@/hooks/use-projects";

/**
 * Everyone on a board or project on the team relays, most involved first.
 * The relays only take events from whitelisted keys, so this is the team as
 * far as the app can see; the whitelist itself lives on the relay.
 */
export function useTeam(): string[] {
  const boards = useEveryBoard();
  const projects = useEveryProject();
  const involvement = new Map<string, number>();
  for (const { members } of [...boards, ...projects]) {
    for (const member of members) {
      involvement.set(member, (involvement.get(member) ?? 0) + 1);
    }
  }
  return [...involvement]
    .toSorted(
      ([a, countA], [b, countB]) => countB - countA || a.localeCompare(b)
    )
    .map(([pubkey]) => pubkey);
}
