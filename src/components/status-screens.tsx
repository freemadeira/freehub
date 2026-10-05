import { npubEncode } from "applesauce-core/helpers/pointers";
import { TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { CopyButton } from "@/components/copy";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { logout } from "@/lib/login";
import { shortNpub } from "@/lib/utils";

export function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="flex w-full max-w-xs flex-col items-center gap-8 text-center">
        {children}
      </div>
    </main>
  );
}

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted-foreground text-sm">{children}</p>
    </div>
  );
}

export function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <Screen>
      <TriangleAlertIcon
        aria-hidden
        className="text-muted-foreground size-8"
        strokeWidth={1.5}
      />
      <Message title="Setup incomplete">{message}</Message>
    </Screen>
  );
}

export function SignerRevoked() {
  return (
    <Screen>
      <Logo className="h-14" />
      <Message title="Session ended">Your signer ended this session.</Message>
      <Button className="w-full" onClick={logout} size="lg">
        Log in again
      </Button>
    </Screen>
  );
}

export function AccessDenied({ pubkey }: { pubkey: string }) {
  return (
    <Screen>
      <Logo className="h-14" />
      <Message title="No access">
        Ask an admin to add this key to the team relay.
      </Message>
      <div className="bg-card shadow-surface flex items-center gap-1 rounded-full py-1 pr-1 pl-4">
        <span className="font-mono text-sm">{shortNpub(pubkey)}</span>
        <CopyButton label="Copy npub" value={npubEncode(pubkey)} />
      </div>
      <div className="flex w-full flex-col gap-2">
        <Button onClick={() => location.reload()} size="lg">
          Try again
        </Button>
        <Button onClick={logout} variant="ghost">
          Use another key
        </Button>
      </div>
    </Screen>
  );
}
