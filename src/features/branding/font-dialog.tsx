import { cn } from "cn";
import { SearchIcon, Trash2Icon, UploadIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFilePicker } from "@/features/branding/brand-parts";
import { addFont, removePart, updatePart } from "@/lib/brand-actions";
import { loadLibraryFont } from "@/lib/brand-files";
import { uploadToBrand } from "@/lib/brand-upload";
import type { Brand, BrandFont, FontSource } from "@/lib/brands";
import {
  cssFamily,
  faceOfFile,
  FONT_ROLES,
  MAX_FONT_FAMILY,
  MAX_FONT_FILES,
  roleParts,
  WEIGHT_NAMES,
} from "@/lib/brands";
import type { ListedFamily } from "@/lib/font-families";
import { loadFamilies, searchFamilies } from "@/lib/font-families";
import type { Project } from "@/lib/project";
import { plural } from "@/lib/utils";

/** A library family as the page draws it, with a sans-serif while it loads. */
function libraryFamily(family: string): string {
  return cssFamily({ family, id: "", source: "library" });
}

/** Weights a new library family starts with, as far as it has them. */
const USUAL_WEIGHTS = [400, 500, 700];
const SAMPLE = "The quick brown fox jumps over the lazy dog";

/** The weights kept of what the family has: the usual ones, else whatever comes first. */
function startingWeights(family: ListedFamily): number[] {
  const usual = USUAL_WEIGHTS.filter((weight) =>
    family.weights.includes(weight)
  );
  return usual.length > 0 ? usual : family.weights.slice(0, 1);
}

/** What the typeface is for: usual parts toggled in their usual order, as many as it serves. */
function RoleField({
  role,
  onChange,
}: {
  role: string;
  onChange: (role: string) => void;
}) {
  const picked = roleParts(role);
  const toggle = (part: string) =>
    onChange(
      FONT_ROLES.filter((item) =>
        item === part ? !picked.includes(item) : picked.includes(item)
      ).join(", ")
    );
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">Used for</legend>
      <div className="flex flex-wrap gap-1.5">
        {FONT_ROLES.map((part) => (
          <button
            aria-pressed={picked.includes(part)}
            className="bg-foreground/5 text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 aria-pressed:bg-foreground aria-pressed:text-background h-7 rounded-full px-3 text-sm transition-colors duration-150 ease-out outline-none focus-visible:ring-3"
            key={part}
            onClick={() => toggle(part)}
            type="button"
          >
            {part}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** The weights the family has, each set in itself, pressed when used. */
function WeightsField({
  family,
  weights,
  available,
  onChange,
}: {
  family: string;
  weights: number[];
  available: number[];
  onChange: (weights: number[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">Weights</legend>
      <div className="flex flex-wrap gap-1.5">
        {available.map((weight) => {
          const on = weights.includes(weight);
          return (
            <button
              aria-pressed={on}
              className="bg-foreground/5 text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 aria-pressed:bg-foreground aria-pressed:text-background h-8 rounded-full px-3 text-sm transition-colors duration-150 ease-out outline-none focus-visible:ring-3"
              key={weight}
              onClick={() => {
                const next = on
                  ? weights.filter((item) => item !== weight)
                  : [...weights, weight].toSorted((a, b) => a - b);
                if (next.length > 0) {
                  onChange(next);
                }
              }}
              style={{ fontFamily: libraryFamily(family), fontWeight: weight }}
              title={WEIGHT_NAMES[weight]}
              type="button"
            >
              {weight}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** The library's families once they've loaded, or whether they couldn't. */
function useFamilies(): { families?: ListedFamily[]; failed: boolean } {
  const [families, setFamilies] = useState<ListedFamily[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const loaded = await loadFamilies();
        if (live) {
          setFamilies(loaded);
        }
      } catch {
        if (live) {
          setFailed(true);
        }
      }
    };
    load();
    return () => {
      live = false;
    };
  }, []);
  return { failed, families };
}

/** Why there's nothing to pick from, if there isn't. */
function PickerStatus({
  families,
  failed,
  found,
}: {
  families?: ListedFamily[];
  failed: boolean;
  found: number;
}) {
  if (failed) {
    return (
      <p className="text-muted-foreground p-3 text-sm">
        The typefaces didn’t load. Check your connection and try again.
      </p>
    );
  }
  if (!families) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  return found === 0 ? (
    <p className="text-muted-foreground p-3 text-sm">
      No typeface by that name.
    </p>
  ) : null;
}

/** The library's families as typed, best first; the picked one previewed in itself. */
function LibraryPicker({
  picked,
  onPick,
}: {
  picked?: ListedFamily;
  onPick: (family: ListedFamily) => void;
}) {
  const id = useId();
  const { families, failed } = useFamilies();
  const [query, setQuery] = useState("");
  const found = families ? searchFamilies(families, query) : [];
  return (
    <div className="flex flex-col gap-2">
      <Label className="sr-only" htmlFor={`${id}-search`}>
        Search typefaces
      </Label>
      <div className="relative">
        <SearchIcon
          aria-hidden
          className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          autoComplete="off"
          autoFocus
          className="pl-9"
          id={`${id}-search`}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search, like Inter, serif or mono"
          value={query}
        />
      </div>
      <div className="bg-muted/50 flex h-52 flex-col overflow-y-auto rounded-xl p-1">
        <PickerStatus
          failed={failed}
          families={families}
          found={found.length}
        />
        <ul aria-label="Typefaces" className="flex flex-col">
          {found.map((family) => (
            <li key={family.family}>
              <button
                aria-pressed={picked?.family === family.family}
                className="hover:bg-foreground/5 aria-pressed:bg-card aria-pressed:shadow-surface focus-visible:ring-ring/50 flex h-9 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm transition-colors duration-100 outline-none focus-visible:ring-3"
                onClick={() => onPick(family)}
                type="button"
              >
                <span className="truncate">{family.family}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {family.category}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface NewFontProps {
  project: Project;
  brand: Brand;
  onDone: () => void;
}

/** A typeface from the font library, or from files the brand keeps. */
function NewFontForm({ project, brand, onDone }: NewFontProps) {
  const id = useId();
  const [source, setSource] = useState<FontSource>("library");
  const [picked, setPicked] = useState<ListedFamily>();
  const [weights, setWeights] = useState<number[]>([]);
  const [family, setFamily] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [role, setRole] = useState("");
  const [saving, setSaving] = useState(false);
  const picker = useFilePicker(
    (chosen) =>
      setFiles((before) => [...before, ...chosen].slice(0, MAX_FONT_FILES)),
    { accept: ".woff2,.woff,.otf,.ttf" }
  );

  useEffect(() => {
    if (picked) {
      loadLibraryFont(picked.family, picked.weights);
    }
  }, [picked]);

  const valid =
    source === "library"
      ? picked !== undefined && weights.length > 0
      : family.trim() !== "" && files.length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) {
      return;
    }
    setSaving(true);
    const made = addFont(project, brand, {
      family: source === "library" ? (picked?.family ?? "") : family,
      role,
      source,
      weights: source === "library" ? weights : [],
    });
    const saved = await made?.saved;
    if (made && saved && source === "file") {
      onDone();
      uploadToBrand(project, brand, { font: made.id, kind: "font" }, files);
      return;
    }
    setSaving(false);
    if (saved) {
      onDone();
    }
  };

  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Add a typeface</DialogTitle>
      </DialogHeader>
      <Tabs
        onValueChange={(value: FontSource) => setSource(value)}
        value={source}
      >
        <TabsList>
          <TabsTrigger value="library">Font library</TabsTrigger>
          <TabsTrigger value="file">Upload files</TabsTrigger>
        </TabsList>
      </Tabs>
      {source === "library" ? (
        <>
          <LibraryPicker
            onPick={(next) => {
              setPicked(next);
              setWeights(startingWeights(next));
            }}
            picked={picked}
          />
          {picked && (
            <>
              <p
                className="truncate text-2xl"
                style={{ fontFamily: libraryFamily(picked.family) }}
              >
                {SAMPLE}
              </p>
              <WeightsField
                available={picked.weights}
                family={picked.family}
                onChange={setWeights}
                weights={weights}
              />
            </>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-family`}>Name</Label>
            <Input
              autoComplete="off"
              id={`${id}-family`}
              maxLength={MAX_FONT_FAMILY}
              onChange={(event) => setFamily(event.target.value)}
              placeholder="Brand Sans"
              value={family}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Files</span>
            {files.length > 0 && (
              <ul className="bg-muted/50 flex max-h-40 flex-col overflow-y-auto rounded-xl p-1 text-sm">
                {files.map((file, index) => {
                  const face = faceOfFile(file.name);
                  return (
                    <li
                      className="flex h-8 items-center justify-between gap-3 rounded-lg px-3"
                      key={`${file.name}-${index}`}
                    >
                      <span className="truncate">{file.name}</span>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {WEIGHT_NAMES[face.weight]}
                        {face.style === "italic" ? " Italic" : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <Button
              className="self-start"
              onClick={() => picker.open()}
              size="sm"
              type="button"
              variant="outline"
            >
              <UploadIcon />
              {files.length > 0 ? "Add more" : "Choose WOFF2, WOFF, OTF or TTF"}
            </Button>
            {picker.input}
          </div>
        </>
      )}
      <RoleField onChange={setRole} role={role} />
      <DialogFooter className="mt-1">
        <DialogClose render={<Button type="button" variant="ghost" />}>
          Cancel
        </DialogClose>
        <Button disabled={!valid || saving} type="submit">
          {saving && <Spinner />}
          {source === "file" && files.length > 0
            ? `Add with ${plural(files.length, "file")}`
            : "Add typeface"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** What a typeface is for, and which of the library's weights it's used in. */
function EditFontForm({
  project,
  font,
  available,
  onDone,
}: {
  project: Project;
  font: BrandFont;
  /** The weights the library has of it, for library typefaces. */
  available?: number[];
  onDone: () => void;
}) {
  const [role, setRole] = useState(font.role);
  const [weights, setWeights] = useState(font.weights);
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await updatePart(project, font, { role, weights })) {
          onDone();
        }
      }}
    >
      <DialogHeader>
        <DialogTitle
          style={{
            fontFamily: cssFamily(font),
          }}
        >
          {font.family}
        </DialogTitle>
      </DialogHeader>
      {font.source === "library" && available && (
        <WeightsField
          available={available}
          family={font.family}
          onChange={setWeights}
          weights={weights}
        />
      )}
      <RoleField onChange={setRole} role={role} />
      <DialogFooter className="mt-1">
        <Button
          className="sm:mr-auto"
          onClick={() => {
            onDone();
            removePart(project, font);
          }}
          type="button"
          variant="destructive"
        >
          <Trash2Icon />
          Remove
        </Button>
        <DialogClose render={<Button type="button" variant="ghost" />}>
          Cancel
        </DialogClose>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  );
}

/** Adds a typeface, or changes the one given. */
export function FontDialog({
  project,
  brand,
  font,
  open,
  onOpenChange,
}: {
  project: Project;
  brand: Brand;
  font?: BrandFont;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { families } = useFamilies();
  const listed =
    font?.source === "library"
      ? families?.find((item) => item.family === font.family)
      : undefined;
  const available = font
    ? [...new Set([...(listed?.weights ?? []), ...font.weights])].toSorted(
        (x, y) => x - y
      )
    : undefined;

  const done = () => onOpenChange(false);
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className={cn("max-h-[90dvh] overflow-y-auto", !font && "sm:max-w-lg")}
        showCloseButton={false}
      >
        {font ? (
          <EditFontForm
            available={available}
            font={font}
            key={font.id}
            onDone={done}
            project={project}
          />
        ) : (
          <NewFontForm brand={brand} onDone={done} project={project} />
        )}
      </DialogContent>
    </Dialog>
  );
}
