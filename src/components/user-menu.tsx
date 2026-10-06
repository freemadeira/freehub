import { npubEncode } from "applesauce-core/helpers/pointers";
import {
  ChevronsUpDownIcon,
  CopyIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { copyText } from "@/components/copy";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { unsynced$ } from "@/lib/publish";
import type { Theme } from "@/lib/theme";
import { setTheme, theme$ } from "@/lib/theme";
import { plural, shortNpub } from "@/lib/utils";

const THEMES = [
  { icon: SunIcon, label: "Light", value: "light" },
  { icon: MoonIcon, label: "Dark", value: "dark" },
  { icon: MonitorIcon, label: "System", value: "system" },
] as const;

// Changes the relay hasn't taken yet stay queued under this key, on this device.
function ConfirmLogout({
  open,
  onOpenChange,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: number;
}) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {plural(pending, "change")} not saved yet
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pending === 1 ? "It hasn’t" : "They haven’t"} reached the relay, so
            your team can’t see {pending === 1 ? "it" : "them"}. If you log out
            now, {pending === 1 ? "it waits" : "they wait"} on this device until
            you log in here again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay logged in</AlertDialogCancel>
          <AlertDialogAction onClick={logout} variant="destructive">
            Log out
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function UserMenu({ pubkey }: { pubkey: string }) {
  const { name } = useProfile(pubkey);
  const theme = useObservableValue(theme$);
  const pending = useObservableValue(unsynced$) ?? 0;
  const [confirming, setConfirming] = useState(false);

  const copyNpub = async () => {
    if (await copyText(npubEncode(pubkey))) {
      toast.success("npub copied");
    }
  };

  return (
    <>
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
              onValueChange={(value: Theme, { event }) =>
                setTheme(value, event)
              }
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
          <DropdownMenuItem
            onClick={() => {
              if (pending > 0) {
                setConfirming(true);
              } else {
                logout();
              }
            }}
          >
            <LogOutIcon />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmLogout
        onOpenChange={setConfirming}
        open={confirming}
        pending={pending}
      />
    </>
  );
}
