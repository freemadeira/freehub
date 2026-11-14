import { cn } from "cn";
import { useEffect, useRef, useState } from "react";

import type { ChapterId } from "@/features/branding/brand-parts";
import { chapterLabel } from "@/features/branding/brand-parts";

/** Below the sticky top bar, where a chapter counts as the one being read. */
const READING_LINE = 120;

/** The chapter being read: the last one whose top has passed the reading line. */
function useCurrentChapter(chapters: ChapterId[]): ChapterId | undefined {
  const [current, setCurrent] = useState<ChapterId>();
  const key = chapters.join(",");

  useEffect(() => {
    const ids = key.split(",").filter(Boolean) as ChapterId[];
    let frame = 0;
    const update = () => {
      frame = 0;
      let found: ChapterId | undefined = ids[0];
      for (const id of ids) {
        const top = document
          .querySelector(`#${id}`)
          ?.getBoundingClientRect().top;
        if (top !== undefined && top <= READING_LINE) {
          found = id;
        }
      }
      // At the very bottom, the last chapter counts even if it's short.
      const scroller = document.scrollingElement;
      if (
        scroller &&
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4
      ) {
        found = ids.at(-1);
      }
      setCurrent(found);
    };
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(update);
      }
    };
    update();
    // Scrolls inside the app's own scroller count too: listen on the way down.
    document.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
    };
  }, [key]);

  return current;
}

function go(id: ChapterId): void {
  document.querySelector(`#${id}`)?.scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
    block: "start",
  });
}

/**
 * The brand's chapters, to jump between: a list beside the page on wide
 * screens, chips across its top on narrow ones, the one being read marked.
 */
export function ChapterRail({ chapters }: { chapters: ChapterId[] }) {
  const current = useCurrentChapter(chapters);
  const chips = useRef<HTMLElement>(null);
  // The chip of the chapter being read stays in sight as the page scrolls.
  useEffect(() => {
    const bar = chips.current;
    const chip = current
      ? bar?.querySelector<HTMLElement>(`[data-chapter="${current}"]`)
      : undefined;
    if (!(bar && chip)) {
      return;
    }
    const left = chip.offsetLeft - bar.offsetLeft;
    if (
      left < bar.scrollLeft ||
      left + chip.offsetWidth > bar.scrollLeft + bar.clientWidth
    ) {
      bar.scrollTo({ left: left - 16 });
    }
  }, [current]);
  if (chapters.length < 2) {
    return null;
  }
  return (
    <>
      <nav
        aria-label="Chapters"
        className="sticky top-20 hidden self-start lg:block"
      >
        <ul className="flex flex-col gap-0.5">
          {chapters.map((id) => (
            <li key={id}>
              <a
                aria-current={id === current ? "location" : undefined}
                className="text-muted-foreground hover:text-foreground aria-[current]:text-foreground focus-visible:ring-ring/50 relative flex h-8 items-center rounded-lg pl-3 text-sm transition-colors duration-150 ease-out outline-none focus-visible:ring-3 aria-[current]:font-medium"
                href={`#${id}`}
                onClick={(event) => {
                  event.preventDefault();
                  go(id);
                }}
              >
                <span
                  aria-hidden
                  className={cn(
                    "bg-foreground absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full transition-opacity duration-150",
                    id === current ? "opacity-100" : "opacity-0"
                  )}
                />
                {chapterLabel(id)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <nav
        aria-label="Chapters"
        className="bg-background/85 sticky top-14 z-20 -mx-4 [scrollbar-width:none] overflow-x-auto px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:hidden"
        ref={chips}
      >
        <ul className="flex w-max gap-1.5">
          {chapters.map((id) => (
            <li key={id}>
              <a
                aria-current={id === current ? "location" : undefined}
                data-chapter={id}
                className="bg-foreground/5 text-muted-foreground aria-[current]:bg-foreground aria-[current]:text-background focus-visible:ring-ring/50 flex h-7 items-center rounded-full px-3 text-sm whitespace-nowrap transition-colors duration-150 ease-out outline-none focus-visible:ring-3"
                href={`#${id}`}
                onClick={(event) => {
                  event.preventDefault();
                  go(id);
                }}
              >
                {chapterLabel(id)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
