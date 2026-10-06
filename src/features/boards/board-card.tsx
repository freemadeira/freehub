import { Link } from "wouter";

import { AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { UserAvatar } from "@/components/user-avatar";
import type { Board } from "@/lib/model";

const VISIBLE_MEMBERS = 5;

export const CARD_SURFACE =
  "bg-card shadow-surface hover:shadow-raised focus-visible:ring-ring/50 flex min-h-36 flex-col gap-2 rounded-2xl p-5 transition-[box-shadow,scale] duration-150 ease-out outline-none focus-visible:ring-3 active:scale-[0.99]";

export function MemberAvatars({
  members,
  className,
}: {
  members: string[];
  className?: string;
}) {
  const hidden = members.length - VISIBLE_MEMBERS;
  return (
    <AvatarGroup className={className}>
      {members.slice(0, VISIBLE_MEMBERS).map((member) => (
        <UserAvatar key={member} pubkey={member} size="sm" />
      ))}
      {hidden > 0 && <AvatarGroupCount>+{hidden}</AvatarGroupCount>}
    </AvatarGroup>
  );
}

export function BoardCard({ board }: { board: Board }) {
  return (
    <Link className={CARD_SURFACE} href={`/${board.code}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 leading-snug font-medium">{board.title}</h3>
        <span className="bg-muted text-muted-foreground shrink-0 rounded-md px-1.5 py-0.5 font-mono text-xs">
          {board.code}
        </span>
      </div>
      {board.description && (
        <p className="text-muted-foreground line-clamp-2 text-sm">
          {board.description}
        </p>
      )}
      <MemberAvatars className="mt-auto pt-2" members={board.members} />
    </Link>
  );
}
