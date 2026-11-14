import { cn } from "cn";
import {
  CheckIcon,
  ChevronDownIcon,
  PencilIcon,
  PipetteIcon,
  Trash2Icon,
} from "lucide-react";
import type { FormEvent, ReactElement } from "react";
import { useId, useState } from "react";

import { copyAndTell, copyText } from "@/components/copy";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AddTile, BrandSection } from "@/features/branding/brand-parts";
import type { Sortable } from "@/features/branding/sortable-parts";
import { SortableParts } from "@/features/branding/sortable-parts";
import { addColor, removePart, updatePart } from "@/lib/brand-actions";
import type { Brand, BrandColor, BrandParts, HexColor } from "@/lib/brands";
import {
  brandTokens,
  clean,
  contrast,
  contrastGrade,
  formatCmyk,
  formatHsl,
  formatRgb,
  INK,
  MAX_COLOR_NAME,
  MAX_COLORS,
  PAPER,
  parseHex,
  TOKEN_FORMATS,
  textOn,
} from "@/lib/brands";
import type { Project } from "@/lib/project";

/** Where a new color starts: the app's accent, so the picker opens somewhere warm. */
const NEW_COLOR: HexColor = "#ffcb05";

interface EyeDropperResult {
  sRGBHex: string;
}

/** The browser's eyedropper, where it has one (Chromium). */
function eyeDropper(): { open: () => Promise<EyeDropperResult> } | undefined {
  const Picker = (
    globalThis as {
      EyeDropper?: new () => { open: () => Promise<EyeDropperResult> };
    }
  ).EyeDropper;
  return Picker ? new Picker() : undefined;
}

/** A value of the color, copied on click. */
function ColorValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="hover:bg-foreground/5 focus-visible:ring-ring/50 -mx-1.5 flex items-center justify-between gap-3 rounded-md px-1.5 py-1 text-left text-xs transition-colors duration-150 ease-out outline-none focus-visible:ring-3"
      onClick={async () => {
        if (await copyText(value)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }
      }}
      title={`Copy ${label}`}
      type="button"
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1 font-mono tabular-nums">
        {copied && <CheckIcon aria-hidden className="size-3" />}
        {copied ? "Copied" : value}
      </span>
    </button>
  );
}

/** How readable white and black text are on the color, as WCAG grades it. */
function ContrastChip({ color, text }: { color: HexColor; text: HexColor }) {
  const ratio = contrast(color, text);
  const grade = contrastGrade(ratio);
  return (
    <div
      className="flex items-center gap-2 text-xs"
      title={`${text === PAPER ? "White" : "Black"} text: ${ratio.toFixed(2)}:1`}
    >
      <span
        aria-hidden
        className="image-outline flex h-6 w-9 shrink-0 items-center justify-center rounded-md font-semibold"
        style={{ background: color, color: text }}
      >
        Aa
      </span>
      <span className="sr-only">
        {text === PAPER ? "White text" : "Black text"}
      </span>
      <span className="text-muted-foreground tabular-nums">
        {ratio.toFixed(1)}
      </span>
      <span
        className={cn(
          "ml-auto font-medium",
          grade === "Fails" && "text-muted-foreground"
        )}
      >
        {grade}
      </span>
    </div>
  );
}

/** The color's name and value, as typed; adds a color or changes one. */
function ColorForm({
  color,
  onSave,
  onRemove,
}: {
  color?: Pick<BrandColor, "name" | "hex">;
  onSave: (name: string, hex: HexColor) => void;
  onRemove?: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(color?.name ?? "");
  const [typed, setTyped] = useState<string>(color?.hex ?? NEW_COLOR);
  const hex = parseHex(typed);
  const picker = eyeDropper();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (hex) {
      onSave(name, hex);
    }
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <div
        aria-hidden
        className="image-outline h-20 rounded-lg transition-colors duration-150"
        style={{ background: hex ?? color?.hex ?? NEW_COLOR }}
      />
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-hex`}>Hex</Label>
        <div className="flex items-center gap-1.5">
          <Input
            aria-invalid={hex === undefined}
            autoComplete="off"
            autoFocus
            className="font-mono"
            id={`${id}-hex`}
            maxLength={7}
            onChange={(event) => setTyped(event.target.value)}
            spellCheck={false}
            value={typed}
          />
          <label
            className="shadow-surface relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-full"
            style={{ background: hex ?? NEW_COLOR }}
            title="Pick a color"
          >
            <input
              aria-label="Pick a color"
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={(event) => setTyped(event.target.value)}
              type="color"
              value={hex ?? NEW_COLOR}
            />
          </label>
          {picker && (
            <Button
              aria-label="Pick from the screen"
              onClick={async () => {
                try {
                  const { sRGBHex } = await picker.open();
                  setTyped(sRGBHex);
                } catch {
                  // Closed without picking.
                }
              }}
              size="icon"
              title="Pick from the screen"
              type="button"
              variant="outline"
            >
              <PipetteIcon />
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input
          autoComplete="off"
          id={`${id}-name`}
          maxLength={MAX_COLOR_NAME}
          onChange={(event) => setName(event.target.value)}
          placeholder="Sunshine"
          value={name}
        />
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        {onRemove && (
          <Button
            className="mr-auto"
            onClick={onRemove}
            size="sm"
            type="button"
            variant="destructive"
          >
            <Trash2Icon />
            Remove
          </Button>
        )}
        <Button disabled={!hex} size="sm" type="submit">
          {color ? "Save" : "Add color"}
        </Button>
      </div>
    </form>
  );
}

/** A popover holding the color's form, opened by `trigger`. */
function ColorPopover({
  trigger,
  color,
  onSave,
  onRemove,
}: {
  trigger: ReactElement;
  color?: BrandColor;
  onSave: (name: string, hex: HexColor) => void;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" className="w-72">
        {open && (
          <ColorForm
            color={color}
            onRemove={
              onRemove &&
              (() => {
                setOpen(false);
                onRemove();
              })
            }
            onSave={(name, hex) => {
              setOpen(false);
              onSave(name, hex);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function Swatch({
  project,
  color,
  editable,
  sortable,
}: {
  project: Project;
  color: BrandColor;
  editable: boolean;
  sortable: Sortable;
}) {
  const [copied, setCopied] = useState(false);
  const ink = textOn(color.hex);
  const name = color.name || color.hex.toUpperCase();
  return (
    <article className="bg-card shadow-surface flex h-full flex-col overflow-hidden rounded-2xl">
      <div
        className="group/swatch relative flex aspect-[3/2] flex-col justify-between p-3 sm:p-4"
        style={{ background: color.hex, color: ink }}
      >
        <button
          aria-label={`Copy ${name}’s hex`}
          className="focus-visible:ring-ring/50 absolute inset-0 cursor-copy outline-none focus-visible:ring-3 focus-visible:ring-inset"
          onClick={async () => {
            if (await copyText(color.hex.toUpperCase())) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }
          }}
          title="Copy hex"
          type="button"
        />
        <span
          aria-live="polite"
          className="pointer-events-none relative text-xs font-medium"
        >
          {copied ? "Copied" : ""}
        </span>
        {editable && (
          <span className="absolute top-2.5 right-2.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/swatch:opacity-90 focus-within:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-90">
            <ColorPopover
              color={color}
              onRemove={() => removePart(project, color)}
              onSave={(next, hex) =>
                updatePart(project, color, {
                  hex,
                  name: clean(next, MAX_COLOR_NAME),
                })
              }
              trigger={
                <button
                  aria-label={`Edit ${name}`}
                  className="focus-visible:ring-ring/50 flex size-7 items-center justify-center rounded-full outline-none hover:bg-current/10 focus-visible:ring-3"
                  type="button"
                >
                  <PencilIcon aria-hidden className="size-4" />
                </button>
              }
            />
            {sortable.handle}
          </span>
        )}
      </div>
      <div className="@container flex flex-1 flex-col gap-3 p-4">
        <h3 className="truncate font-medium">{name}</h3>
        <div className="flex flex-col">
          <ColorValue label="Hex" value={color.hex.toUpperCase()} />
          <ColorValue label="RGB" value={formatRgb(color.hex)} />
          <ColorValue label="HSL" value={formatHsl(color.hex)} />
          <ColorValue label="CMYK" value={formatCmyk(color.hex)} />
        </div>
        <div className="mt-auto flex flex-col gap-1.5">
          <ContrastChip color={color.hex} text={PAPER} />
          <ContrastChip color={color.hex} text={INK} />
        </div>
      </div>
    </article>
  );
}

/** The brand's colors with every value, and the colors and type as code. */
export function ColorsSection({
  project,
  brand,
  parts,
  editable,
}: {
  project: Project;
  brand: Brand;
  parts: BrandParts;
  editable: boolean;
}) {
  const { colors, fonts } = parts;
  const hasTokens = colors.length + fonts.length > 0;
  const adding = editable && colors.length < MAX_COLORS;
  return (
    <BrandSection
      action={
        hasTokens && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="sm" variant="outline" />}
            >
              Copy tokens
              <ChevronDownIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {TOKEN_FORMATS.map(({ format, label }) => (
                <DropdownMenuItem
                  key={format}
                  onClick={() =>
                    copyAndTell(
                      brandTokens(brand, colors, fonts, format),
                      `${label} copied`
                    )
                  }
                >
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }
      id="colors"
    >
      <SortableParts
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        editable={editable}
        group="colors"
        handleClassName="hover:bg-current/10"
        label={(color) => color.name || color.hex.toUpperCase()}
        parts={colors}
        project={project}
        render={(color, sortable) => (
          <Swatch
            color={color}
            editable={editable}
            key={color.id}
            project={project}
            sortable={sortable}
          />
        )}
      >
        {adding && (
          <ColorPopover
            onSave={(name, hex) => addColor(project, brand, { hex, name })}
            trigger={<AddTile className="min-h-40" label="Add color" />}
          />
        )}
      </SortableParts>
    </BrandSection>
  );
}
