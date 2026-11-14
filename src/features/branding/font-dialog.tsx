import { cn } from "cn";
import { SearchIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFilePicker } from "@/features/branding/brand-parts";
import { addFont, removePart, updatePart } from "@/lib/brand-actions";
import { loadLibraryFont } from "@/lib/brand-files";
import { uploadToBrand } from "@/lib/brand-upload";
import type {
  Brand,
  BrandFile,
  BrandFont,
  Face,
  FontSource,
} from "@/lib/brands";
import {
  cssFamily,
  faceOfFile,
  fileFace,
  filesIn,
  FONT_ROLES,
  FONT_WEIGHTS,
  MAX_FONT_FAMILY,
  MAX_FONT_FILES,
  roleParts,
  VARIABLE,
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

/** Files a typeface takes. */
export const FONT_ACCEPT = ".woff2,.woff,.otf,.ttf";

/** Every weight a file can be, the variable one first. */
const FACE_WEIGHTS = [VARIABLE, ...FONT_WEIGHTS];

function weightName(weight: number): string {
  return weight === VARIABLE ? "Variable" : `${weight} ${WEIGHT_NAMES[weight]}`;
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
  const list = useRef<HTMLUListElement>(null);
  /** Moves focus through the results with the arrow keys, from the search field too. */
  const move = (event: KeyboardEvent<HTMLElement>) => {
    const buttons = [...(list.current?.querySelectorAll("button") ?? [])];
    const at = buttons.indexOf(event.target as HTMLButtonElement);
    const by = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (by === undefined) {
      return;
    }
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, at + by))]?.focus();
  };
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
          onKeyDown={(event) => {
            // Enter picks the best match rather than adding what was picked before.
            const [best] = found;
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (best) {
                onPick(best);
              }
            } else {
              move(event);
            }
          }}
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
        <ul aria-label="Typefaces" className="flex flex-col" ref={list}>
          {found.map((family) => (
            <li key={family.family}>
              <button
                aria-pressed={picked?.family === family.family}
                className="hover:bg-foreground/5 aria-pressed:bg-card aria-pressed:shadow-surface focus-visible:ring-ring/50 flex h-9 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm transition-colors duration-100 outline-none focus-visible:ring-3"
                onClick={() => onPick(family)}
                onKeyDown={move}
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
    { accept: FONT_ACCEPT }
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
                      className="flex h-8 items-center gap-3 rounded-lg pr-1 pl-3"
                      key={`${file.name}-${index}`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {file.name}
                      </span>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {weightName(face.weight)}
                        {face.style === "italic" ? " Italic" : ""}
                      </span>
                      <Button
                        aria-label={`Leave out ${file.name}`}
                        onClick={() =>
                          setFiles((before) =>
                            before.filter((_, at) => at !== index)
                          )
                        }
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        <XIcon />
                      </Button>
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
/** One uploaded file of a typeface: the weight and style it draws, or taken off. */
function FontFileRow({ project, file }: { project: Project; file: BrandFile }) {
  const face = fileFace(file);
  const save = (change: Partial<Face>) =>
    updatePart(project, file, { face: { ...face, ...change } });
  return (
    <li className="flex items-center gap-2 py-1">
      <span className="min-w-0 flex-1 truncate text-sm" title={file.name}>
        {file.name}
      </span>
      <Select
        items={FACE_WEIGHTS.map((weight) => ({
          label: weightName(weight),
          value: String(weight),
        }))}
        onValueChange={(next: string | null) =>
          next !== null && save({ weight: Number(next) })
        }
        value={String(face.weight)}
      >
        <SelectTrigger
          aria-label={`Weight of ${file.name}`}
          className="h-8 w-36"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FACE_WEIGHTS.map((weight) => (
            <SelectItem key={weight} value={String(weight)}>
              {weightName(weight)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        aria-label={`Italic: ${file.name}`}
        aria-pressed={face.style === "italic"}
        className="aria-pressed:bg-foreground aria-pressed:text-background italic"
        onClick={() =>
          save({ style: face.style === "italic" ? "normal" : "italic" })
        }
        size="icon-sm"
        title="Italic"
        type="button"
        variant="ghost"
      >
        I
      </Button>
      <Button
        aria-label={`Remove ${file.name}`}
        onClick={() => removePart(project, file)}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <Trash2Icon />
      </Button>
    </li>
  );
}

/** An uploaded typeface's files, each with its face, and a way to add more. */
function FontFilesField({
  project,
  brand,
  font,
  files,
}: {
  project: Project;
  brand: Brand;
  font: BrandFont;
  files: BrandFile[];
}) {
  const own = filesIn(files, { font: font.id, kind: "font" });
  const picker = useFilePicker(
    (picked) =>
      uploadToBrand(project, brand, { font: font.id, kind: "font" }, picked),
    { accept: FONT_ACCEPT }
  );
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Files</span>
      {own.length > 0 && (
        <ul className="bg-muted/50 flex max-h-56 flex-col overflow-y-auto rounded-xl px-3 py-1.5">
          {own.map((file) => (
            <FontFileRow file={file} key={file.id} project={project} />
          ))}
        </ul>
      )}
      {own.length < MAX_FONT_FILES && (
        <Button
          className="self-start"
          onClick={() => picker.open()}
          size="sm"
          type="button"
          variant="outline"
        >
          <UploadIcon />
          Add files
        </Button>
      )}
      {picker.input}
    </div>
  );
}

function EditFontForm({
  project,
  brand,
  font,
  files,
  onDone,
}: {
  project: Project;
  brand: Brand;
  font: BrandFont;
  /** The brand's files, for an uploaded typeface's own. */
  files: BrandFile[];
  onDone: () => void;
}) {
  const { families } = useFamilies();
  const listed =
    font.source === "library"
      ? families?.find((item) => item.family === font.family)
      : undefined;
  // What the library has of it, with any weights kept that it no longer lists.
  const available = listed
    ? [...new Set([...listed.weights, ...font.weights])].toSorted(
        (x, y) => x - y
      )
    : undefined;
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
        <DialogTitle style={{ fontFamily: cssFamily(font) }}>
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
      {font.source === "file" && (
        <FontFilesField
          brand={brand}
          files={files}
          font={font}
          project={project}
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
  files,
  open,
  onOpenChange,
}: {
  project: Project;
  brand: Brand;
  font?: BrandFont;
  /** The brand's files, for an uploaded typeface's own. */
  files: BrandFile[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const done = () => onOpenChange(false);
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className={cn("max-h-[90dvh] overflow-y-auto", !font && "sm:max-w-lg")}
        showCloseButton={false}
      >
        {font ? (
          <EditFontForm
            brand={brand}
            files={files}
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
