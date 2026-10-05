import type { ComponentProps } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useProfile } from "@/hooks/use-profile";

// A stable two-tone gradient per key, so people without a picture stay recognizable.
function gradient(pubkey: string): string {
  const from = Number.parseInt(pubkey.slice(0, 4), 16) % 360;
  const to =
    (from + 40 + (Number.parseInt(pubkey.slice(4, 6), 16) % 100)) % 360;
  return `linear-gradient(135deg, oklch(0.8 0.12 ${from}), oklch(0.6 0.16 ${to}))`;
}

type UserAvatarProps = ComponentProps<typeof Avatar> & { pubkey: string };

export function UserAvatar({ pubkey, ...props }: UserAvatarProps) {
  const { name, picture } = useProfile(pubkey);
  return (
    <Avatar {...props}>
      {picture && <AvatarImage alt={name} src={picture} />}
      <AvatarFallback style={{ backgroundImage: gradient(pubkey) }}>
        <span className="sr-only">{name}</span>
      </AvatarFallback>
    </Avatar>
  );
}
