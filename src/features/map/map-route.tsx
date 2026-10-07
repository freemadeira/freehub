import { cn } from "cn";
import { MapIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "wouter";

import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { getConfig } from "@/config";
import type { CrmScope } from "@/features/crm/crm-context";
import { CrmContext, recordPath } from "@/features/crm/crm-context";
import { RecordSheet } from "@/features/crm/record-sheet";
import { TableIcon } from "@/features/crm/table-icon";
import type { MapEngine } from "@/features/map/engine";
import { MapList } from "@/features/map/map-list";
import { mapRecordHref, parseReference } from "@/features/map/map-path";
import type { MapViewState } from "@/features/map/map-view";
import { MapMarker, MapView } from "@/features/map/map-view";
import type { Pin } from "@/features/map/pins";
import {
  ALL_TABLES,
  mappedTables,
  pinColors,
  pinReference,
  pinsFor,
} from "@/features/map/pins";
import { useCrmContents } from "@/hooks/use-crm-contents";
import { firstValue, recordTitle } from "@/lib/crm";
import { setValues } from "@/lib/crm-actions";
import type { Location } from "@/lib/location";
import { locationValue, readLocation } from "@/lib/location";
import { canEdit } from "@/lib/model";
import type { Project } from "@/lib/project";

/** Past this camera distance pins shrink to dots, so the island stays readable. */
const COMPACT = 14_000;
/** The record sheet's width on wide screens, as `sm:max-w-xl` sets it. */
const SHEET_WIDTH = 576;

/** Flies to a record, keeping it clear of its sheet on the right. */
function flyToRecord(engine: MapEngine, location: Location, sheet: boolean) {
  const covered = sheet ? Math.min(SHEET_WIDTH, window.innerWidth * 0.75) : 0;
  engine.flyTo(
    { distance: 900, lat: location.lat, lng: location.lng },
    { offset: -covered / 2 }
  );
}

function MapPin({
  pin,
  selected,
  highlighted,
  compact,
  onSelect,
}: {
  pin: Pin;
  selected: boolean;
  /** Pointed at in the list. */
  highlighted: boolean;
  compact: boolean;
  onSelect: () => void;
}) {
  const title = recordTitle(pin.record);
  return (
    <button
      aria-label={pin.stage ? `${title}, ${pin.stage.label}` : title}
      aria-pressed={selected}
      className="group focus-visible:ring-ring/50 pointer-events-auto relative block -translate-x-1/2 -translate-y-1/2 rounded-full outline-none focus-visible:ring-3"
      onClick={onSelect}
      type="button"
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-full border-2 border-white shadow-[0_2px_6px_rgb(30_40_70/0.35)] transition-transform duration-150 ease-out group-hover:scale-110 dark:border-white/90",
          compact ? "size-3" : "size-7",
          selected && "scale-125 group-hover:scale-125",
          highlighted && !selected && "scale-110",
          pinColors(pin)
        )}
      >
        {!compact && (
          <TableIcon
            className="size-3.5"
            icon={pin.table.icon}
            strokeWidth={2.4}
          />
        )}
      </span>
      {!compact && (
        <span
          className={cn(
            "bg-background/95 text-foreground pointer-events-none absolute top-full left-1/2 mt-1 -translate-x-1/2 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap shadow-sm transition-opacity duration-150",
            selected || highlighted
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
          )}
        >
          {title}
        </span>
      )}
    </button>
  );
}

function PickBanner({
  title,
  onCancel,
}: {
  title: string;
  onCancel: () => void;
}) {
  return (
    <div className="bg-background/95 shadow-surface absolute top-3 left-1/2 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-full py-1 pr-1 pl-4 text-sm backdrop-blur">
      <span className="truncate">
        Click the map to place <span className="font-medium">{title}</span>
      </span>
      <Button
        aria-label="Cancel"
        className="shrink-0 rounded-full"
        onClick={onCancel}
        size="icon-sm"
        variant="ghost"
      >
        <XIcon />
      </Button>
    </div>
  );
}

interface MapRouteProps {
  projects: Project[];
  pubkey: string;
}

export function MapRoute({ projects, pubkey }: MapRouteProps) {
  const world = getConfig().map?.world ?? "";
  const [, navigate] = useLocation();
  const [params, setParams] = useSearchParams();
  const { contents } = useCrmContents(projects);
  const [filter, setFilter] = useState(ALL_TABLES);
  const [hovered, setHovered] = useState<string>();
  const [engine, setEngine] = useState<MapEngine>();

  const tables = mappedTables(projects, contents);
  const { located, listed, shown, pins } = pinsFor(tables, filter);
  const find = (value: string | null) => {
    const reference = parseReference(value);
    const mapped = tables.find(
      (table) =>
        table.project.slug === reference?.project &&
        table.table.slug === reference.table
    );
    const record = mapped?.content.byTable
      .get(mapped.table.id)
      ?.find((item) => item.id === reference?.record);
    return mapped && record && reference
      ? { ...mapped, record, reference }
      : undefined;
  };
  const selected = find(params.get("record"));
  const picking = find(params.get("pick"));
  const pickField = picking?.table.fields.find(
    (field) => field.id === picking.reference.field && field.type === "location"
  );
  const canPick =
    picking && pickField && canEdit(picking.project, pubkey)
      ? picking
      : undefined;
  const focus = selected ?? canPick;
  const focusLocation = focus
    ? readLocation(firstValue(focus.record, (pickField ?? focus.field).id))
    : undefined;
  const focusLat = focusLocation?.lat;
  const focusLng = focusLocation?.lng;

  const sheetOpen = selected !== undefined;
  const selectedReference = selected
    ? `${selected.reference.project}/${selected.reference.table}/${selected.reference.record}`
    : undefined;
  // Fly to the record a link points at, once both it and the map are ready.
  useEffect(() => {
    if (engine && focusLat !== undefined && focusLng !== undefined) {
      flyToRecord(engine, { lat: focusLat, lng: focusLng }, sheetOpen);
    }
  }, [engine, focusLat, focusLng, sheetOpen]);

  const open = (pin: Pin) => {
    const reference = pinReference(pin);
    if (reference === selectedReference && engine) {
      // Already open, so the link stays put: fly back to it by hand.
      flyToRecord(engine, pin.location, true);
      return;
    }
    setParams({ record: reference });
  };

  const leavePick = () => {
    if (canPick) {
      navigate(recordPath(canPick.project, canPick.table, canPick.record), {
        replace: true,
      });
    }
  };

  const place = (location: Location) => {
    if (!(canPick && pickField)) {
      return;
    }
    setValues(canPick.table, canPick.record, pickField.id, [
      locationValue(location),
    ]);
    leavePick();
  };

  const scope: CrmScope | undefined = selected
    ? {
        canEdit: canEdit(selected.project, pubkey),
        content: selected.content,
        project: selected.project,
        pubkey,
        recordHref: (record) =>
          mapRecordHref(selected.project, selected.table, record),
        records: selected.content.byTable.get(selected.table.id) ?? [],
        table: selected.table,
      }
    : undefined;

  const renderPins = (map: MapEngine, view: MapViewState) =>
    pins.map((pin) => {
      const reference = pinReference(pin);
      return (
        <MapMarker engine={map} key={reference} location={pin.location}>
          <MapPin
            compact={view.distance > COMPACT}
            highlighted={reference === hovered}
            onSelect={() => setParams({ record: reference })}
            pin={pin}
            selected={reference === selectedReference}
          />
        </MapMarker>
      );
    });

  return (
    <>
      <TopBar
        crumbs={[
          {
            icon: <MapIcon className="text-muted-foreground size-4 shrink-0" />,
            label: "Map",
          },
        ]}
      />
      <main className="relative min-h-0 flex-1 overflow-hidden">
        <MapView
          cursor={canPick ? "crosshair" : undefined}
          onClick={canPick ? place : undefined}
          onReady={setEngine}
          world={world}
        >
          {(map, view) => (
            <>
              {renderPins(map, view)}
              {canPick ? (
                <PickBanner
                  onCancel={leavePick}
                  title={recordTitle(canPick.record)}
                />
              ) : (
                located.length > 0 && (
                  <MapList
                    filter={shown}
                    onFilter={setFilter}
                    onHover={setHovered}
                    onSelect={open}
                    pins={pins}
                    selected={selectedReference}
                    tables={listed}
                    withProjects={projects.length > 1}
                  />
                )
              )}
            </>
          )}
        </MapView>
      </main>
      {selected && scope && (
        <CrmContext value={scope}>
          <RecordSheet
            onClose={() => setParams({}, { replace: true })}
            open
            record={selected.record}
          />
        </CrmContext>
      )}
    </>
  );
}
