import type { ReactNode } from "react";

/** Something the `#` list offers, going into the text as its address. */
export interface RefOption {
  /** Its kind and id, which no other option shares. */
  key: string;
  title: string;
  /** Where it sits, like a card's key and board, or a link's catalog. */
  context?: string;
  icon: ReactNode;
  /** Its full address in the app. */
  url: string;
}

export interface RefSearchProps {
  /** What's typed after the `#`. */
  query: string;
  /** Address of the project to look in; everywhere without one. */
  project?: string;
  /** What the words find, best first, each time that changes. */
  onOptions: (options: RefOption[]) => void;
}

/** An option as the `#` list shows it: its icon, title and where it sits. */
export function RefOptionRow({ option }: { option: RefOption }) {
  return (
    <>
      <span aria-hidden className="flex size-4 shrink-0 items-center">
        {option.icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{option.title}</span>
      {option.context && (
        <span className="text-muted-foreground max-w-[45%] shrink-0 truncate text-xs">
          {option.context}
        </span>
      )}
    </>
  );
}
