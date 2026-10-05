import { npubEncode } from "applesauce-core/helpers/pointers";
import {
  CopyIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react";
import { toast } from "sonner";

import { copyText } from "@/components/copy";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user-avatar";
import { useObservableValue } from "@/hooks/use-observable-value";
import { useProfile } from "@/hooks/use-profile";
import { logout } from "@/lib/login";
import type { Theme } from "@/lib/theme";
import { setTheme, theme$ } from "@/lib/theme";
import { shortNpub } from "@/lib/utils";

const THEMES = [
  { icon: SunIcon, label: "Light", value: "light" },
  { icon: MoonIcon, label: "Dark", value: "dark" },
  { icon: MonitorIcon, label: "System", value: "system" },
] as const;

export function UserMenu({ pubkey }: { pubkey: string }) {
  const { name } = useProfile(pubkey);
  const theme = useObservableValue(theme$);

  const copyNpub = async () => {
    if (await copyText(npubEncode(pubkey))) {
      toast.success("npub copied");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button aria-label="Account" size="icon" variant="ghost" />}
      >
        <UserAvatar pubkey={pubkey} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <UserAvatar pubkey={pubkey} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="text-muted-foreground truncate font-mono text-xs">
              {shortNpub(pubkey)}
            </p>
          </div>
        </div>
        <DropdownMenuItem onClick={copyNpub}>
          <CopyIcon />
          Copy npub
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            onValueChange={(value: Theme, { event }) => setTheme(value, event)}
            value={theme}
          >
            {THEMES.map(({ value, label, icon: Icon }) => (
              <DropdownMenuRadioItem
                closeOnClick={false}
                key={value}
                value={value}
              >
                <Icon />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout}>
          <LogOutIcon />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
