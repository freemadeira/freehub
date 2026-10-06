import { FluidTooltip } from "@/components/ui/fluid-tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { UserAvatar } from "@/components/user-avatar";
import { useProfile } from "@/hooks/use-profile";

function Member({ pubkey }: { pubkey: string }) {
  const { name } = useProfile(pubkey);
  return (
    <FluidTooltip.Root>
      <FluidTooltip.Trigger>
        <ToggleGroupItem
          aria-label={name}
          className="ring-background data-pressed:ring-primary rounded-full ring-2 transition-[opacity,box-shadow] duration-150 group-has-data-pressed/filter:opacity-50 hover:z-10 hover:opacity-100 focus-visible:z-10 data-pressed:z-10 data-pressed:opacity-100"
          value={pubkey}
        >
          <UserAvatar pubkey={pubkey} size="sm" />
        </ToggleGroupItem>
      </FluidTooltip.Trigger>
      <FluidTooltip.Content>{name}</FluidTooltip.Content>
    </FluidTooltip.Root>
  );
}

interface AssigneeFilterProps {
  members: string[];
  value?: string;
  onChange: (value?: string) => void;
}

export function AssigneeFilter({
  members,
  value,
  onChange,
}: AssigneeFilterProps) {
  if (members.length < 2) {
    return null;
  }
  return (
    <ToggleGroup
      aria-label="Filter by assignee"
      className="group/filter gap-0 -space-x-1"
      onValueChange={(next) => onChange(next[0])}
      value={value ? [value] : []}
    >
      <FluidTooltip.Group>
        {members.map((member) => (
          <Member key={member} pubkey={member} />
        ))}
      </FluidTooltip.Group>
    </ToggleGroup>
  );
}
