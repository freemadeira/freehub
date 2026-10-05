import { MotionConfig } from "motion/react";
import { Redirect, Route, Switch, useRoute } from "wouter";

import { Header } from "@/components/header";
import { AccessDenied, SignerRevoked } from "@/components/status-screens";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardRoute, parseSlug } from "@/features/board/board-route";
import { BoardsPage } from "@/features/boards/boards-page";
import { LoginPage } from "@/features/login/login-page";
import { useBoards } from "@/hooks/use-boards";
import { useObservableValue } from "@/hooks/use-observable-value";
import { accounts } from "@/lib/nostr";
import { access$ } from "@/lib/relays";
import { signerState$ } from "@/lib/signer";

function Workspace({ pubkey }: { pubkey: string }) {
  const { boards, loaded } = useBoards(pubkey);
  const [, params] = useRoute<{ slug: string }>("/:slug");
  const slug = params ? parseSlug(params.slug) : undefined;
  const board = slug
    ? boards.find((item) => item.code === slug.code)
    : undefined;

  return (
    <div className="flex min-h-dvh flex-col">
      <Header board={board} pubkey={pubkey} />
      <Switch>
        <Route path="/">
          <BoardsPage boards={boards} loaded={loaded} pubkey={pubkey} />
        </Route>
        {slug && (
          <Route path="/:slug">
            <BoardRoute
              board={board}
              boards={boards}
              cardNumber={slug.number}
              loaded={loaded}
              pubkey={pubkey}
            />
          </Route>
        )}
        <Route>
          <Redirect replace to="/" />
        </Route>
      </Switch>
    </div>
  );
}

function Gate() {
  const account = useObservableValue(accounts.active$);
  const signer = useObservableValue(signerState$);
  const access = useObservableValue(access$);

  if (!account) {
    return <LoginPage />;
  }
  if (signer === "revoked") {
    return <SignerRevoked />;
  }
  if (access === "denied") {
    return <AccessDenied pubkey={account.pubkey} />;
  }
  return <Workspace pubkey={account.pubkey} />;
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <Gate />
        <Toaster position="bottom-center" />
      </TooltipProvider>
    </MotionConfig>
  );
}
