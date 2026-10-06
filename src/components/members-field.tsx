import { normalizeToPubkey } from "applesauce-core/helpers/pointers";
import { XIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/user-avatar";
import { useProfile } from "@/hooks/use-profile";

const NO_SUGGESTIONS: string[] = [];

function parseMember(value: string): string | null {
  return normalizeToPubkey(value.trim().replace(/^nostr:/u, ""));
}

function MemberRow({
  pubkey,
  you,
  onRemove,
}: {
  pubkey: string;
  you: boolean;
  onRemove?: () => void;
}) {
  const { name } = useProfile(pubkey);
  return (
    <li className="flex h-10 items-center gap-2.5">
      <UserAvatar aria-hidden pubkey={pubkey} size="sm" />
      <span className="min-w-0 truncate">{name}</span>
      {you && <span className="text-muted-foreground">You</span>}
      {onRemove && (
        <Button
          aria-label={`Remove ${name}`}
          className="ml-auto"
          onClick={onRemove}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon />
        </Button>
      )}
    </li>
  );
}

interface MembersFieldProps {
  creator: string;
  members: string[];
  onChange: (members: string[]) => void;
  pubkey: string;
  /** People offered with one click, like the members of the parent project. */
  suggestions?: string[];
}

export function MembersField({
  creator,
  members,
  onChange,
  pubkey,
  suggestions = NO_SUGGESTIONS,
}: MembersFieldProps) {
  const id = useId();
  const [candidate, setCandidate] = useState("");
  const [error, setError] = useState<string>();
  const missing = suggestions.filter((member) => !members.includes(member));

  const add = () => {
    if (!candidate.trim()) {
      return;
    }
    const member = parseMember(candidate);
    if (!member) {
      setError("Not a valid npub.");
      return;
    }
    if (!members.includes(member)) {
      onChange([...members, member]);
    }
    setCandidate("");
  };

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Members</Label>
      <ul className="flex flex-col">
        {members.map((member) => (
          <MemberRow
            key={member}
            onRemove={
              member === creator
                ? undefined
                : () => onChange(members.filter((item) => item !== member))
            }
            pubkey={member}
            you={member === pubkey}
          />
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error ? true : undefined}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          id={id}
          onChange={(event) => {
            setCandidate(event.target.value);
            setError(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder="npub1…"
          spellCheck={false}
          value={candidate}
        />
        <Button
          disabled={!candidate.trim()}
          onClick={add}
          type="button"
          variant="outline"
        >
          Add
        </Button>
      </div>
      {error && (
        <p className="text-destructive text-xs" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
      {missing.length > 0 && (
        <Button
          className="self-start"
          onClick={() => onChange([...members, ...missing])}
          size="sm"
          type="button"
          variant="ghost"
        >
          Add all project members
        </Button>
      )}
    </div>
  );
}
