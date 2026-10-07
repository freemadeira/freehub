import "@/index.css";
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/app";
import { ConfigErrorScreen } from "@/components/status-screens";
import { ConfigError, loadConfig } from "@/config";
import { pruneDrafts } from "@/lib/drafts";
import { initNostr } from "@/lib/nostr";
import { startOutbox } from "@/lib/publish";
import { startRelays } from "@/lib/relays";
import { startSignerChecks } from "@/lib/signer";
import { applyAccent, startTheme } from "@/lib/theme";

async function boot(): Promise<ReactNode> {
  startTheme();
  try {
    const config = await loadConfig();
    document.title = config.name;
    applyAccent(config.accent);
  } catch (error) {
    return (
      <ConfigErrorScreen
        message={
          error instanceof ConfigError
            ? error.message
            : "config.json couldn’t be loaded."
        }
      />
    );
  }
  initNostr();
  startSignerChecks();
  startRelays();
  startOutbox();
  pruneDrafts();
  return <App />;
}

const root = document.querySelector("#root");
if (root) {
  createRoot(root).render(<StrictMode>{await boot()}</StrictMode>);
}
