import { npubEncode } from "applesauce-core/helpers/pointers";
import {
  ChevronsUpDownIcon,
  CopyIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react";
import { toast } from "sonner";

import { copyText } from "@/components/copy";
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
import { SidebarMenuButton } from "@/components/ui/sidebar";
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
        render={
          <SidebarMenuButton
            aria-label="Account"
            className="data-popup-open:bg-sidebar-accent"
            size="lg"
          />
        }
      >
        <UserAvatar pubkey={pubkey} />
        <span className="grid min-w-0 flex-1 text-left leading-tight">
          <span className="truncate font-medium">{name}</span>
          <span className="text-muted-foreground truncate font-mono text-xs">
            {shortNpub(pubkey)}
          </span>
        </span>
        <ChevronsUpDownIcon className="text-muted-foreground ml-auto" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-(--anchor-width) min-w-56"
        side="top"
      >
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
