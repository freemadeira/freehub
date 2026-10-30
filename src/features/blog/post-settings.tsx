import { cn } from "cn";
import { format, fromUnixTime, getUnixTime, set } from "date-fns";
import {
  CalendarIcon,
  ImagePlusIcon,
  RotateCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { WebsiteConfig } from "@/config";
import { languageName, postName } from "@/features/blog/blog-context";
import { People, Person } from "@/features/card/card-parts";
import type {
  BlogContent,
  ImageMeta,
  PostFields,
  SharedFields,
} from "@/lib/blog";
import {
  cleanPostSlug,
  cleanTopics,
  isValidSlug,
  postSlug,
  slugTakenBy,
} from "@/lib/blog";
import { MAX_IMAGE_BYTES, uploadImage } from "@/lib/blog-actions";
import type { Project } from "@/lib/project";
import { errorMessage } from "@/lib/utils";

/** Fields typed into, saved once focus leaves them. */
export type TypedFields = Pick<PostFields, "slug" | "summary" | "coverAlt">;

interface PostSettingsProps {
  project: Project;
  website: WebsiteConfig;
  blog: BlogContent;
  /** The language's fields, with what's being typed. */
  fields: PostFields;
  editable: boolean;
  /** Typing into a field. */
  onType: (change: Partial<TypedFields>) => void;
  /** Focus left a field typed into: save it. */
  onTyped: () => void;
  /** The cover, topics or byline changed, in every language. */
  onShared: (change: Partial<SharedFields>, cover?: ImageMeta) => void;
  /** The date the post shows, or none for when it's first published. */
  onDate: (publishedAt?: number) => void;
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id?: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
    </div>
  );
}

function LinkField({
  blog,
  website,
  fields,
  editable,
  onType,
  onTyped,
}: Pick<
  PostSettingsProps,
  "blog" | "website" | "fields" | "editable" | "onType" | "onTyped"
>) {
  const id = useId();
  const taken = slugTakenBy(blog, fields);
  const invalid = fields.slug !== "" && !isValidSlug(fields.slug);
  const base = fields.locale === website.locales[0] ? "" : `/${fields.locale}`;
  let hint: ReactNode = `${new URL(website.url).host}${base}/blog/${fields.slug || "…"}`;
  if (invalid) {
    hint = (
      <span className="text-destructive">
        Use lowercase letters, digits and hyphens.
      </span>
    );
  } else if (taken) {
    const name = postName(taken.post) || "Another post";
    hint = (
      <span
        className={
          taken.published
            ? "text-destructive"
            : "text-amber-600 dark:text-amber-400"
        }
      >
        {taken.published
          ? `“${name}” is published with this link in ${languageName(fields.locale)}.`
          : `“${name}” uses this link in ${languageName(fields.locale)} too.`}
      </span>
    );
  }
  return (
    <Field hint={hint} id={id} label="Link">
      <Input
        aria-invalid={invalid || taken?.published}
        disabled={!editable}
        id={id}
        onBlur={() => {
          // A hyphen left at the end while typing goes, as in links made from titles.
          if (fields.slug !== postSlug(fields.slug)) {
            onType({ slug: postSlug(fields.slug) });
          }
          onTyped();
        }}
        onChange={(event) =>
          onType({ slug: cleanPostSlug(event.target.value) })
        }
        placeholder="made-from-the-title"
        value={fields.slug}
      />
    </Field>
  );
}

/** The cover: shared by the languages, with alt text in each. */
function CoverField({
  website,
  fields,
  editable,
  onType,
  onTyped,
  onShared,
}: Pick<
  PostSettingsProps,
  "website" | "fields" | "editable" | "onType" | "onTyped" | "onShared"
>) {
  const altId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<{
    file: File;
    preview: string;
    progress: number;
    error?: string;
  }>();

  const send = async (file: File) => {
    const preview =
      upload?.file === file ? upload.preview : URL.createObjectURL(file);
    setUpload({ file, preview, progress: 0 });
    try {
      const image = await uploadImage(file, website, {
        onProgress: (progress) =>
          setUpload((current) => current && { ...current, progress }),
      });
      onShared({ cover: image.url }, image);
      URL.revokeObjectURL(preview);
      setUpload(undefined);
    } catch (error) {
      setUpload(
        (current) => current && { ...current, error: errorMessage(error) }
      );
    }
  };

  const shown = upload?.preview ?? fields.cover;
  return (
    <div className="flex flex-col gap-2">
      <Label>Cover</Label>
      {shown ? (
        <div className="group/cover relative overflow-hidden rounded-lg">
          <img
            alt={fields.coverAlt}
            className={cn(
              "aspect-video w-full object-cover",
              upload && !upload.error && "opacity-70"
            )}
            src={shown}
          />
          {upload?.error && (
            <div className="bg-background/85 absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center backdrop-blur-sm">
              <p className="text-destructive text-xs">{upload.error}</p>
              <div className="flex gap-1">
                <Button
                  onClick={() => send(upload.file)}
                  size="xs"
                  variant="outline"
                >
                  <RotateCwIcon />
                  Try again
                </Button>
                <Button
                  onClick={() => {
                    URL.revokeObjectURL(upload.preview);
                    setUpload(undefined);
                  }}
                  size="xs"
                  variant="ghost"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {upload && !upload.error && (
            <div className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-black/30">
              <div
                className="h-full bg-white transition-[width] duration-200 ease-out"
                style={{ width: `${Math.round(upload.progress * 100)}%` }}
              />
            </div>
          )}
          {editable && !upload && (
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity duration-150 group-hover/cover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
              <Button
                onClick={() => picker.current?.click()}
                size="xs"
                variant="outline"
              >
                Change
              </Button>
              <Button
                aria-label="Remove cover"
                onClick={() => onShared({ cover: undefined })}
                size="icon-xs"
                variant="outline"
              >
                <Trash2Icon />
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Button
          className="border-input h-24 rounded-lg border-dashed"
          disabled={!editable}
          onClick={() => picker.current?.click()}
          variant="ghost"
        >
          <ImagePlusIcon />
          Add a cover
        </Button>
      )}
      <input
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const [file] = event.target.files ?? [];
          event.target.value = "";
          if (file) {
            send(file);
          }
        }}
        ref={picker}
        type="file"
      />
      {fields.cover && (
        <>
          <Label className="sr-only" htmlFor={altId}>
            Cover alt text, in {languageName(fields.locale)}
          </Label>
          <Input
            disabled={!editable}
            id={altId}
            onBlur={onTyped}
            onChange={(event) => onType({ coverAlt: event.target.value })}
            placeholder={`Alt text, in ${languageName(fields.locale)}`}
            value={fields.coverAlt}
          />
        </>
      )}
      <p className="text-muted-foreground text-xs">
        Shared by every language. Pictures up to {MAX_IMAGE_BYTES / 1024 / 1024}{" "}
        MB are public as soon as they’re uploaded.
      </p>
    </div>
  );
}

function TopicsField({
  fields,
  editable,
  onShared,
}: Pick<PostSettingsProps, "fields" | "editable" | "onShared">) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const add = () => {
    const next = cleanTopics([...fields.topics, ...typed.split(",")]);
    setTyped("");
    if (next.length !== fields.topics.length) {
      onShared({ topics: next });
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add();
    } else if (
      event.key === "Backspace" &&
      typed === "" &&
      fields.topics.length > 0
    ) {
      onShared({ topics: fields.topics.slice(0, -1) });
    }
  };
  return (
    <Field hint="Shared by every language." id={id} label="Topics">
      <div className="border-input bg-card dark:bg-input/30 focus-within:border-ring focus-within:ring-ring/30 flex min-h-9 flex-wrap items-center gap-1 rounded-lg border px-1.5 py-1 transition-[border-color,box-shadow] focus-within:ring-3">
        {fields.topics.map((topic) => (
          <span
            className="bg-foreground/6 flex items-center gap-0.5 rounded-md py-0.5 pr-0.5 pl-1.5 text-sm"
            key={topic}
          >
            {topic}
            {editable && (
              <button
                aria-label={`Remove ${topic}`}
                className="text-muted-foreground hover:text-foreground rounded-sm p-0.5 transition-colors"
                onClick={() =>
                  onShared({
                    topics: fields.topics.filter((each) => each !== topic),
                  })
                }
                type="button"
              >
                <XIcon className="size-3" />
              </button>
            )}
          </span>
        ))}
        {editable && (
          <input
            className="placeholder:text-muted-foreground min-w-24 grow bg-transparent px-1 text-sm outline-none"
            id={id}
            onBlur={() => typed.trim() && add()}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={fields.topics.length > 0 ? "" : "bitcoin, events…"}
            value={typed}
          />
        )}
      </div>
    </Field>
  );
}

function BylineField({
  project,
  fields,
  editable,
  onShared,
}: Pick<PostSettingsProps, "project" | "fields" | "editable" | "onShared">) {
  const id = useId();
  // Members first, in the project's order; anyone named before who left stays until taken off.
  const people = [
    ...project.members,
    ...fields.authors.filter((author) => !project.members.includes(author)),
  ];
  return (
    <Field
      hint="Who the post is from. Shared by every language."
      id={id}
      label="Byline"
    >
      <Select
        disabled={!editable}
        multiple
        onValueChange={(next: string[]) => {
          // A post is always from someone.
          if (next.length > 0) {
            onShared({
              authors: people.filter((person) => next.includes(person)),
            });
          }
        }}
        value={fields.authors}
      >
        <SelectTrigger className="w-full" id={id}>
          <SelectValue className="items-center gap-2">
            {(current: string[]) => <People pubkeys={current} />}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {people.map((pubkey) => (
            <SelectItem key={pubkey} value={pubkey}>
              <Person pubkey={pubkey} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function DateField({
  fields,
  editable,
  onDate,
}: Pick<PostSettingsProps, "fields" | "editable" | "onDate">) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const date =
    fields.publishedAt === undefined
      ? undefined
      : fromUnixTime(fields.publishedAt);
  const pick = (day?: Date) => {
    setOpen(false);
    if (!day) {
      onDate();
      return;
    }
    // The day picked, at the time it had, or at noon, which is that day everywhere near.
    const at = date
      ? set(day, {
          hours: date.getHours(),
          minutes: date.getMinutes(),
          seconds: date.getSeconds(),
        })
      : set(day, { hours: 12, minutes: 0, seconds: 0 });
    onDate(getUnixTime(at));
  };
  return (
    <Field
      hint={
        date
          ? "Changing it shows as an unpublished change until you update."
          : "Set on publishing, unless you pick one."
      }
      id={id}
      label="Publish date"
    >
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger
          className="border-input bg-card dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/30 flex h-9 items-center gap-2 rounded-lg border px-3 text-left text-sm transition-[border-color,box-shadow] outline-none focus-visible:ring-3 disabled:opacity-50"
          disabled={!editable}
          id={id}
        >
          <CalendarIcon className="text-muted-foreground size-4" />
          {date ? (
            format(date, "PPp")
          ) : (
            <span className="text-muted-foreground">
              When it’s first published
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="flex flex-col gap-1 p-2">
          <Calendar
            defaultMonth={date}
            mode="single"
            onSelect={pick}
            selected={date}
          />
          {date && (
            <Button onClick={() => pick()} size="sm" variant="ghost">
              Clear
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </Field>
  );
}

/** A language's settings: its link, summary and date, and what the languages share. */
export function PostSettings(props: PostSettingsProps) {
  const { fields, editable, onType, onTyped } = props;
  const summaryId = useId();
  return (
    <div className="flex flex-col gap-6">
      <LinkField {...props} />
      <Field
        hint={`In ${languageName(fields.locale)}: shown in lists and when shared.`}
        id={summaryId}
        label="Summary"
      >
        <Textarea
          disabled={!editable}
          id={summaryId}
          onBlur={onTyped}
          onChange={(event) => onType({ summary: event.target.value })}
          placeholder="A sentence or two about the post."
          value={fields.summary}
        />
      </Field>
      <CoverField {...props} />
      <TopicsField {...props} />
      <BylineField {...props} />
      <DateField {...props} />
    </div>
  );
}
