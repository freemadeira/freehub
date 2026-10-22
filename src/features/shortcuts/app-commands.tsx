import type { ReactNode } from "react";
import { createContext, use, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import { usePlaces } from "@/components/app-link";
import { ConfirmLogout } from "@/components/user-menu";
import { getConfig } from "@/config";
import { editableBoards, QuickCard } from "@/features/card/quick-card";
import { docsPath } from "@/features/docs/docs-context";
import { drivePath } from "@/features/drive/drive-context";
import { INBOX_PATH } from "@/features/inbox/inbox-page";
import { MAP_PATH } from "@/features/map/map-path";
import { CommandPalette } from "@/features/palette/command-palette";
import type { PaletteStart } from "@/features/palette/palette-context";
import { PaletteContext } from "@/features/palette/palette-context";
import { useProjectInView } from "@/features/projects/use-project-in-view";
import { SEARCH_PATH } from "@/features/search/search-path";
import { ShortcutsDialog } from "@/features/shortcuts/shortcuts-dialog";
import { useObservableValue } from "@/hooks/use-observable-value";
import { useShortcut, useShortcuts } from "@/hooks/use-shortcut";
import { hasBlossom } from "@/lib/blossom";
import { logout } from "@/lib/login";
import { focusedElement, returnFocus } from "@/lib/opener";
import { unsynced$ } from "@/lib/publish";
import { PROJECT_KEYS, SHORTCUTS } from "@/lib/shortcuts";

/** What can be done from anywhere in the app, by button or by shortcut. */
export interface AppCommands {
  /** Whether there's a board the user can add cards to. */
  canAddCards: boolean;
  /** A new card, on the board that fits where it's opened. */
  newCard: () => void;
  /** The command palette, or one of its lists, like the statuses a card can move to. */
  openPalette: (start?: PaletteStart) => void;
  /** The page's own search where it has one, or else search of everything. */
  search: () => void;
  /** The list of keyboard shortcuts. */
  showShortcuts: () => void;
}

const AppCommandsContext = createContext<AppCommands | null>(null);

export function useAppCommands(): AppCommands {
  const commands = use(AppCommandsContext);
  if (!commands) {
    throw new Error("useAppCommands needs an AppCommandsProvider.");
  }
  return commands;
}

interface AppCommandsProviderProps {
  pubkey: string;
  /** Starts a new project. */
  onNewProject: () => void;
  children: ReactNode;
}

/** The app's commands, the shortcuts that run them, and the dialogs they open. */
export function AppCommandsProvider({
  pubkey,
  onNewProject,
  children,
}: AppCommandsProviderProps) {
  const { boards, projects } = usePlaces();
  const [, navigate] = useLocation();
  const pending = useObservableValue(unsynced$) ?? 0;
  const [creating, setCreating] = useState(false);
  const [helping, setHelping] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // What had focus as a dialog opened, to give it back to as it closes. One
  // opened from the palette gives it back to what had focus before the palette.
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const [palette, setPalette] = useState<{
    open: boolean;
    session: number;
    start?: PaletteStart;
  }>({ open: false, session: 0 });
  // Docs and Drive go to the project in view.
  const here = useProjectInView();
  const canAddCards = editableBoards(boards, pubkey).length > 0;

  const commands = useMemo<AppCommands>(() => {
    const keepOpener = () => {
      if (!palette.open) {
        setOpener(focusedElement());
      }
    };
    return {
      canAddCards,
      newCard: () => {
        if (canAddCards) {
          keepOpener();
          setCreating(true);
        } else {
          toast("No board to add cards to");
        }
      },
      openPalette: (start) => {
        keepOpener();
        setPalette(({ session }) => ({
          open: true,
          session: session + 1,
          start,
        }));
      },
      search: () => {
        const field =
          document.querySelector<HTMLInputElement>("[data-page-search]");
        if (field) {
          field.focus();
          field.select();
        } else {
          navigate(SEARCH_PATH);
        }
      },
      showShortcuts: () => {
        keepOpener();
        setHelping(true);
      },
    };
  }, [canAddCards, navigate, palette.open]);

  const closePalette = () => setPalette((now) => ({ ...now, open: false }));

  // From fields too, as other shortcuts with Ctrl or ⌘ work; pressed again, it closes.
  useShortcut(
    SHORTCUTS["palette.open"],
    () => (palette.open ? closePalette() : commands.openPalette()),
    { inFields: true }
  );

  useShortcuts([
    { keys: SHORTCUTS["search.open"], run: commands.search },
    { keys: SHORTCUTS["shortcuts.show"], run: commands.showShortcuts },
    { keys: SHORTCUTS["card.new"], run: commands.newCard },
    {
      keys: SHORTCUTS["go.project"],
      run: () => commands.openPalette("projects"),
    },
    { keys: SHORTCUTS["go.board"], run: () => commands.openPalette("boards") },
    { keys: SHORTCUTS["go.home"], run: () => navigate("/") },
    { keys: SHORTCUTS["go.inbox"], run: () => navigate(INBOX_PATH) },
    {
      enabled: getConfig().map !== undefined,
      keys: SHORTCUTS["go.map"],
      run: () => navigate(MAP_PATH),
    },
    {
      enabled: here !== undefined,
      keys: SHORTCUTS["go.docs"],
      run: () => here && navigate(docsPath(here)),
    },
    {
      enabled: here !== undefined && hasBlossom(),
      keys: SHORTCUTS["go.drive"],
      run: () => here && navigate(drivePath(here)),
    },
    // In the sidebar's order, which numbers them.
    ...PROJECT_KEYS.map((keys, index) => {
      const project = projects[index];
      return {
        enabled: project !== undefined,
        keys,
        run: () => project && navigate(`/p/${project.slug}`),
      };
    }),
  ]);

  return (
    <AppCommandsContext value={commands}>
      <PaletteContext value={commands.openPalette}>{children}</PaletteContext>
      <QuickCard
        finalFocus={returnFocus(opener)}
        onOpenChange={setCreating}
        open={creating}
        pubkey={pubkey}
      />
      <ShortcutsDialog
        finalFocus={returnFocus(opener)}
        onOpenChange={setHelping}
        open={helping}
      />
      <CommandPalette
        commands={{
          canAddCards,
          here,
          // Changes the relay hasn't taken yet would wait on this device.
          logOut: () => (pending > 0 ? setLeaving(true) : logout()),
          newCard: commands.newCard,
          newProject: onNewProject,
          pubkey,
          showShortcuts: commands.showShortcuts,
        }}
        finalFocus={returnFocus(opener)}
        onOpenChange={(open) => {
          if (!open) {
            closePalette();
          }
        }}
        open={palette.open}
        session={palette.session}
        start={palette.start}
      />
      <ConfirmLogout
        onOpenChange={setLeaving}
        open={leaving}
        pending={pending}
      />
    </AppCommandsContext>
  );
}
