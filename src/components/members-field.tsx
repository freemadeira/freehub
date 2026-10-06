import { Combobox } from "@base-ui/react/combobox";
import {
  normalizeToPubkey,
  npubEncode,
} from "applesauce-core/helpers/pointers";
import { cn } from "cn";
import {
  CornerDownLeftIcon,
  PlusIcon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { RefObject } from "react";
import { useId, useRef, useState } from "react";

import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { FIELD } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserAvatar } from "@/components/user-avatar";
import { useProfile } from "@/hooks/use-profile";
import { useProfileNames } from "@/hooks/use-profile-names";
import { useTeam } from "@/hooks/use-team";
import type { Membership } from "@/lib/model";
import { plural, shortNpub } from "@/lib/utils";

const MAX_CHIPS = 5;
const STACKED = 3;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const KEY = /(?:npub|nprofile)1[02-9ac-hj-np-z]+|\b[0-9a-f]{64}\b/giu;
const LOOKS_LIKE_KEY = /^(?:nostr:)?(?:npub|nprofile)1/iu;

type Role = "member" | "viewer";

const ROLES: { label: string; value: Role }[] = [
  { label: "Can edit", value: "member" },
  { label: "Can view", value: "viewer" },
];

/**
 * Everyone on a board or project with their role, in the order they were
 * added, so changing someone's role leaves them where they are in the list.
 */
export type Roster = ReadonlyMap<string, Role>;

export function toRoster({ members, viewers }: Membership): Roster {
  const roster = new Map<string, Role>(
    members.map((member) => [member, "member"])
  );
  for (const viewer of viewers) {
    if (!roster.has(viewer)) {
      roster.set(viewer, "viewer");
    }
  }
  return roster;
}

export function fromRoster(roster: Roster): Membership {
  const withRole = (role: Role) =>
    [...roster].flatMap(([pubkey, held]) => (held === role ? [pubkey] : []));
  return { members: withRole("member"), viewers: withRole("viewer") };
}

function people(count: number): string {
  return count === 1 ? "1 person" : `${count} people`;
}

/** Every key in pasted text: one npub, or a whole list like a whitelist file. */
function pubkeysIn(text: string): string[] {
  const found = new Set<string>();
  for (const [match] of text.matchAll(KEY)) {
    const pubkey = normalizeToPubkey(match.toLowerCase());
    if (pubkey) {
      found.add(pubkey);
    }
  }
  return [...found];
}

type Option =
  | { kind: "person"; pubkey: string; newcomer: boolean }
  | { kind: "people"; pubkeys: string[] };

function emptyMessage(text: string, pasted: string[]): string {
  if (pasted.length > 0) {
    return pasted.length === 1
      ? "Already a member."
      : "They’re all members already.";
  }
  if (LOOKS_LIKE_KEY.test(text)) {
    return "That npub doesn’t look complete.";
  }
  if (text) {
    return `No one named “${text}” yet. Paste their npub to add them.`;
  }
  return "Everyone on the team is here. Paste an npub to add someone new.";
}

function Tag({ children }: { children: string }) {
  return (
    <span className="bg-foreground/5 text-muted-foreground shrink-0 rounded-md px-1.5 py-0.5 text-xs">
      {children}
    </span>
  );
}

function RoleSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Role;
  onChange: (role: Role) => void;
}) {
  return (
    <Select
      items={ROLES}
      onValueChange={(next: Role | null) => {
        if (next) {
          onChange(next);
        }
      }}
      value={value}
    >
      <SelectTrigger
        aria-label={label}
        className="text-muted-foreground hover:bg-foreground/5 hover:text-foreground data-popup-open:bg-foreground/5 data-popup-open:text-foreground h-8 gap-1 border-transparent bg-transparent px-2 transition-colors duration-150 dark:bg-transparent"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {ROLES.map((role) => (
          <SelectItem key={role.value} value={role.value}>
            {role.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MemberRow({
  pubkey,
  role,
  you,
  owner,
  onRoleChange,
  onRemove,
}: {
  pubkey: string;
  role: Role;
  you: boolean;
  /** The creator, who always edits and can't be removed. */
  owner: boolean;
  onRoleChange: (role: Role) => void;
  onRemove: () => void;
}) {
  const { name } = useProfile(pubkey);
  return (
    <motion.li
      animate={{ height: "auto", opacity: 1 }}
      className="overflow-hidden"
      exit={{ height: 0, opacity: 0 }}
      initial={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
    >
      <div className="group/member hover:bg-foreground/5 flex h-10 items-center gap-2.5 rounded-lg px-2 transition-colors duration-150">
        <UserAvatar aria-hidden pubkey={pubkey} size="sm" />
        <span className="min-w-0 truncate">{name}</span>
        {you && <Tag>You</Tag>}
        {owner && <Tag>Owner</Tag>}
        {!owner && (
          <span className="-mr-1 ml-auto flex shrink-0 items-center gap-0.5">
            <RoleSelect
              label={`What ${name} can do`}
              onChange={onRoleChange}
              value={role}
            />
            <IconButton
              className="opacity-0 transition-opacity duration-150 group-hover/member:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              label={`Remove ${name}`}
              onClick={onRemove}
              size="icon-xs"
              tooltip="Remove"
            >
              <XIcon />
            </IconButton>
          </span>
        )}
      </div>
    </motion.li>
  );
}

function PersonOption({
  pubkey,
  newcomer,
}: {
  pubkey: string;
  newcomer: boolean;
}) {
  const { name } = useProfile(pubkey);
  const npub = shortNpub(pubkey);
  return (
    <>
      <UserAvatar aria-hidden pubkey={pubkey} size="sm" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{name}</span>
        {name !== npub && (
          <span className="text-muted-foreground truncate text-xs">{npub}</span>
        )}
      </span>
      {newcomer && <Tag>New</Tag>}
    </>
  );
}

function PeopleOption({ pubkeys }: { pubkeys: string[] }) {
  return (
    <>
      <span className="flex shrink-0 -space-x-1.5">
        {pubkeys.slice(0, STACKED).map((pubkey) => (
          <UserAvatar
            aria-hidden
            className="ring-popover ring-2"
            key={pubkey}
            pubkey={pubkey}
            size="sm"
          />
        ))}
      </span>
      <span className="truncate">Add {people(pubkeys.length)}</span>
    </>
  );
}

interface AddPeopleProps {
  id: string;
  team: string[];
  members: string[];
  names: Map<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onAdd: (pubkeys: string[]) => void;
}

function AddPeople({
  id,
  team,
  members,
  names,
  open,
  onOpenChange,
  inputRef,
  onAdd,
}: AddPeopleProps) {
  const [query, setQuery] = useState("");
  const text = query.trim();
  const needle = text.toLowerCase();
  const pasted = pubkeysIn(text);
  const fresh = pasted.filter((pubkey) => !members.includes(pubkey));

  let options: Option[];
  if (pasted.length > 1) {
    options = fresh.length > 0 ? [{ kind: "people", pubkeys: fresh }] : [];
  } else if (pasted.length === 1) {
    options = fresh.map((pubkey) => ({
      kind: "person",
      newcomer: !team.includes(pubkey),
      pubkey,
    }));
  } else {
    options = team
      .filter(
        (pubkey) =>
          !members.includes(pubkey) &&
          ((names.get(pubkey) ?? "").toLowerCase().includes(needle) ||
            npubEncode(pubkey).startsWith(needle))
      )
      .map((pubkey) => ({ kind: "person", newcomer: false, pubkey }));
  }

  return (
    <Combobox.Root
      autoHighlight
      filter={null}
      inputValue={query}
      itemToStringLabel={() => ""}
      items={options}
      onInputValueChange={setQuery}
      onOpenChange={onOpenChange}
      onValueChange={(option: Option | null) => {
        if (option) {
          onAdd(option.kind === "person" ? [option.pubkey] : option.pubkeys);
          setQuery("");
        }
      }}
      open={open}
      openOnInputClick
      value={null}
    >
      <div className="relative">
        <UserPlusIcon
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Combobox.Input
          autoCapitalize="off"
          autoCorrect="off"
          className={cn(FIELD, "h-9 pl-9")}
          id={id}
          // Enter adds the highlighted person; it never submits the dialog.
          onKeyDown={(event) => {
            if (event.key === "Enter" && text) {
              event.preventDefault();
            }
          }}
          placeholder="Add people by name or npub…"
          ref={inputRef}
          spellCheck={false}
        />
      </div>
      <Combobox.Portal>
        <Combobox.Positioner className="isolate z-50" sideOffset={6}>
          <Combobox.Popup className="bg-popover text-popover-foreground shadow-raised max-h-[min(18rem,var(--available-height))] w-(--anchor-width) origin-(--transform-origin) overflow-y-auto overscroll-contain rounded-xl p-1 transition-[opacity,scale] duration-150 ease-out outline-none data-ending-style:scale-[0.96] data-ending-style:opacity-0 data-ending-style:duration-100 data-starting-style:scale-[0.96] data-starting-style:opacity-0">
            <Combobox.Empty className="text-muted-foreground px-3 py-5 text-center text-sm text-balance empty:hidden">
              {emptyMessage(text, pasted)}
            </Combobox.Empty>
            <Combobox.List>
              {(option: Option) => (
                <Combobox.Item
                  className="group/option data-highlighted:bg-accent data-highlighted:text-accent-foreground flex h-11 cursor-default items-center gap-2.5 rounded-lg px-2 text-sm outline-none select-none"
                  key={option.kind === "person" ? option.pubkey : "people"}
                  value={option}
                >
                  {option.kind === "person" ? (
                    <PersonOption
                      newcomer={option.newcomer}
                      pubkey={option.pubkey}
                    />
                  ) : (
                    <PeopleOption pubkeys={option.pubkeys} />
                  )}
                  <CornerDownLeftIcon
                    aria-hidden
                    className="text-muted-foreground ml-auto size-3.5 shrink-0 opacity-0 transition-opacity duration-150 group-data-highlighted/option:opacity-100"
                  />
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

function SuggestionChip({
  pubkey,
  onAdd,
}: {
  pubkey: string;
  onAdd: () => void;
}) {
  const { name } = useProfile(pubkey);
  return (
    <motion.button
      animate={{ opacity: 1, scale: 1 }}
      aria-label={`Add ${name}`}
      className="bg-foreground/5 hover:bg-foreground/10 focus-visible:ring-ring/50 flex h-7 items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-0.5 text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-3"
      exit={{ opacity: 0, scale: 0.9 }}
      initial={{ opacity: 0, scale: 0.9 }}
      onClick={onAdd}
      transition={{ duration: 0.15, ease: EASE_OUT }}
      type="button"
      whileTap={{ scale: 0.96 }}
    >
      <UserAvatar aria-hidden pubkey={pubkey} size="xs" />
      <span className="max-w-28 truncate">{name.split(" ")[0]}</span>
      <PlusIcon aria-hidden className="text-muted-foreground size-3" />
    </motion.button>
  );
}

interface MembersFieldProps {
  creator: string;
  roster: Roster;
  onChange: (roster: Roster) => void;
  pubkey: string;
  /** The project around a board, whose people can all be added at once. */
  group?: { name: string; roster: Roster };
}

/**
 * Who belongs to a board or project, and whether each can edit or only view.
 * People already on the team's boards and projects are offered by name; anyone
 * else joins by pasting their npub.
 */
export function MembersField({
  creator,
  roster,
  onChange,
  pubkey,
  group,
}: MembersFieldProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const team = useTeam();
  const listed = [...roster.keys()];
  const names = useProfileNames([...new Set([...listed, ...team])]);
  const candidates = team.filter((person) => !roster.has(person));
  const fromGroup = group
    ? [...group.roster.keys()].filter((person) => !roster.has(person))
    : [];
  const nameOf = (person: string) => names.get(person) ?? shortNpub(person);

  const add = (added: string[], from?: Roster) => {
    const fresh = added.filter((person) => !roster.has(person));
    const [only] = fresh;
    if (!only) {
      return;
    }
    const next = new Map(roster);
    for (const person of fresh) {
      next.set(person, from?.get(person) ?? "member");
    }
    onChange(next);
    setAnnouncement(
      fresh.length === 1
        ? `Added ${nameOf(only)}`
        : `Added ${people(fresh.length)}`
    );
  };

  const remove = (person: string) => {
    const next = new Map(roster);
    next.delete(person);
    onChange(next);
    setAnnouncement(`Removed ${nameOf(person)}`);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>Members</Label>
        <span className="text-muted-foreground text-xs tabular-nums">
          {plural(roster.size, "member")}
        </span>
      </div>
      <FluidTooltip.Group>
        <ul
          aria-label="Members"
          className="-mx-2 flex max-h-64 flex-col overflow-y-auto"
        >
          <AnimatePresence initial={false}>
            {[...roster].map(([person, role]) => (
              <MemberRow
                key={person}
                onRemove={() => remove(person)}
                onRoleChange={(next) =>
                  onChange(new Map(roster).set(person, next))
                }
                owner={person === creator}
                pubkey={person}
                role={role}
                you={person === pubkey}
              />
            ))}
          </AnimatePresence>
        </ul>
      </FluidTooltip.Group>
      <AddPeople
        id={id}
        inputRef={input}
        members={listed}
        names={names}
        onAdd={add}
        onOpenChange={setOpen}
        open={open}
        team={team}
      />
      {(fromGroup.length > 0 || candidates.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {fromGroup.length > 0 && group && (
            <Button
              className="h-7 rounded-full"
              onClick={() => add(fromGroup, group.roster)}
              size="xs"
              type="button"
              variant="secondary"
            >
              <UsersIcon />
              Add everyone from {group.name}
            </Button>
          )}
          <AnimatePresence initial={false}>
            {candidates.slice(0, MAX_CHIPS).map((member) => (
              <SuggestionChip
                key={member}
                onAdd={() => add([member])}
                pubkey={member}
              />
            ))}
          </AnimatePresence>
          {candidates.length > MAX_CHIPS && (
            <button
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 h-7 rounded-full px-2 text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-3"
              onClick={() => {
                input.current?.focus();
                setOpen(true);
              }}
              type="button"
            >
              {candidates.length - MAX_CHIPS} more
            </button>
          )}
        </div>
      )}
      <output className="sr-only">{announcement}</output>
    </div>
  );
}
