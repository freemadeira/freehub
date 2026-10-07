import { cn } from "cn";
import { InfoIcon, NavigationIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import type { Marker } from "@/features/map/engine";
import { MapEngine } from "@/features/map/engine";
import type { Location } from "@/lib/location";

function subscribeToTheme(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

interface MapMarkerProps {
  engine: MapEngine;
  location: Location;
  /** Labels with a priority hide when they'd overlap a higher one. */
  priority?: number;
  children: ReactNode;
}

/** React content kept over a place on the map. */
export function MapMarker({
  engine,
  location,
  priority,
  children,
}: MapMarkerProps) {
  const element = useMemo(() => document.createElement("div"), []);
  const marker = useRef<Marker | null>(null);
  const { lat, lng } = location;
  // The marker is added once; later moves go through `setPosition` below.
  const place = useEffectEvent(() => ({ lat, lng }));
  useEffect(() => {
    const added = engine.addMarker(element, place(), { priority });
    marker.current = added;
    return () => added.remove();
  }, [engine, element, priority]);
  useEffect(() => {
    marker.current?.setPosition({ lat, lng });
  }, [lat, lng]);
  return createPortal(children, element);
}

function Compass({ engine, heading }: { engine: MapEngine; heading: number }) {
  const turned = heading > 2 && heading < 358;
  return (
    <Button
      aria-label="Turn north up"
      className={cn(
        "bg-background/90 shadow-surface absolute top-3 right-3 rounded-full backdrop-blur transition-opacity duration-200",
        turned ? "opacity-100" : "pointer-events-none opacity-0"
      )}
      onClick={() => engine.resetNorth()}
      size="icon"
      tabIndex={turned ? 0 : -1}
      variant="ghost"
    >
      <NavigationIcon
        className="text-red-500"
        fill="currentColor"
        style={{ transform: `rotate(${-heading}deg)` }}
      />
    </Button>
  );
}

const OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright";

/** Where the map's data comes from, folded behind a button out of the way. */
function Attribution({ lines }: { lines: string[] }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Map data credits"
        className="bg-background/70 text-foreground/50 hover:text-foreground focus-visible:ring-ring/50 data-popup-open:text-foreground absolute right-2 bottom-2 flex size-6 items-center justify-center rounded-full backdrop-blur transition-colors outline-none focus-visible:ring-3"
      >
        <InfoIcon className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="text-muted-foreground flex w-72 flex-col gap-1.5 text-xs"
        side="top"
      >
        {lines.map((line) =>
          line.includes("OpenStreetMap") ? (
            <a
              className="hover:text-foreground underline-offset-2 hover:underline"
              href={OSM_COPYRIGHT}
              key={line}
              rel="noreferrer"
              target="_blank"
            >
              {line}
            </a>
          ) : (
            <p key={line}>{line}</p>
          )
        )}
      </PopoverContent>
    </Popover>
  );
}

export interface MapViewState {
  /** Meters from the camera to what it looks at. */
  distance: number;
}

interface MapViewProps {
  /** URL of the world pack's `world.json`. */
  world: string;
  onReady?: (engine: MapEngine) => void;
  onClick?: (location: Location) => void;
  /** Markers and anything else drawn over the map once it's ready. */
  children?: (engine: MapEngine, view: MapViewState) => ReactNode;
  cursor?: string;
}

/** The 3D map in the app: the engine, its theme, markers and controls. */
export function MapView({
  world,
  onReady,
  onClick,
  children,
  cursor,
}: MapViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<MapEngine>();
  const [failure, setFailure] = useState<string>();
  const [view, setView] = useState({ distance: 3000, heading: 0 });
  const dark = useSyncExternalStore(subscribeToTheme, isDark);
  const clicked = useEffectEvent((location: Location) => onClick?.(location));
  const ready = useEffectEvent((next: MapEngine) => onReady?.(next));

  useEffect(() => {
    const element = host.current;
    if (!element) {
      return;
    }
    let created: MapEngine | undefined;
    let cancelled = false;
    const start = async () => {
      try {
        const next = await MapEngine.create({
          container: element,
          onClick: clicked,
          onViewChange: setView,
          reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches,
          theme: isDark() ? "night" : "day",
          world,
        });
        if (cancelled) {
          next.dispose();
          return;
        }
        created = next;
        setEngine(next);
        ready(next);
      } catch (error) {
        if (!cancelled) {
          setFailure(error instanceof Error ? error.message : String(error));
        }
      }
    };
    start();
    return () => {
      cancelled = true;
      created?.dispose();
      setEngine(undefined);
    };
  }, [world]);

  useEffect(() => {
    engine?.setTheme(dark ? "night" : "day");
  }, [engine, dark]);

  useEffect(() => {
    engine?.setCursor(cursor ?? "");
  }, [engine, cursor]);

  if (failure) {
    return (
      <Empty>
        <EmptyTitle>The map couldn’t load</EmptyTitle>
        <EmptyDescription>{failure}</EmptyDescription>
      </Empty>
    );
  }

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        ref={host}
        style={{ ["--fhm-font" as string]: "var(--font-sans)" }}
      />
      {engine ? (
        <>
          {children?.(engine, { distance: view.distance })}
          <Compass engine={engine} heading={view.heading} />
          <Attribution lines={engine.manifest.attribution} />
        </>
      ) : (
        <div className="text-muted-foreground absolute inset-0 flex items-center justify-center">
          <Spinner className="size-5" />
          <span className="sr-only">Loading the map</span>
        </div>
      )}
    </div>
  );
}
