import { createContext, use } from "react";
import { toast } from "sonner";

import { useObservableValue } from "@/hooks/use-observable-value";
import type { HomePrefs, Pin } from "@/lib/home";
import { homePrefs, pinKey } from "@/lib/home";
import type { HomeStore } from "@/lib/home-store";
import { homeStore } from "@/lib/home-store";

export interface HomeSettings {
  prefs: HomePrefs;
  set: HomeStore["set"];
  setPinned: HomeStore["setPinned"];
}

export const HomeContext = createContext<HomeSettings | null>(null);

/** The person's Home settings, as this device last saw them until the relay answers. */
export function useHomeSettings(pubkey: string): HomeSettings {
  const store = homeStore(pubkey);
  const prefs = useObservableValue(() => store.prefs$, [pubkey]);
  return {
    prefs: prefs ?? homePrefs({}),
    set: store.set,
    setPinned: store.setPinned,
  };
}

export function useHome(): HomeSettings {
  const home = use(HomeContext);
  if (!home) {
    throw new Error("useHome needs a HomeContext provider.");
  }
  return home;
}

export interface PinToggle {
  pinned: boolean;
  /** Pins or unpins it; `announce` says so in a toast, for menus that close. */
  toggle: (announce?: boolean) => void;
}

export function usePin(pin: Pin): PinToggle {
  const { prefs, setPinned } = useHome();
  const key = pinKey(pin);
  const pinned = prefs.pins.some((item) => pinKey(item) === key);
  return {
    pinned,
    toggle: (announce = false) => {
      const undo = setPinned(pin, !pinned);
      if (announce) {
        toast(pinned ? "Unpinned from Home" : "Pinned to Home", {
          action: { label: "Undo", onClick: undo },
        });
      }
    },
  };
}
