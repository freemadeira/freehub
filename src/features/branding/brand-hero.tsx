import { cn } from "cn";
import { LinkIcon, PencilIcon } from "lucide-react";
import type { CSSProperties, FormEvent, KeyboardEvent } from "react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { BrandCover, BrandMark } from "@/features/branding/brand-card";
import { PlatformIcon } from "@/features/catalogs/platform-icon";
import { updateBrand } from "@/lib/brand-actions";
import type { Brand, BrandParts } from "@/lib/brands";
import {
  cssFamily,
  MAX_BRAND_DESCRIPTION,
  MAX_BRAND_NAME,
  MAX_SOCIALS,
  textFonts,
} from "@/lib/brands";
import { hostOf, platformName, platformOf } from "@/lib/catalogs";
import type { Project } from "@/lib/project";

/** A link as it reads: its host and path, without the scheme. */
function linkLabel(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    const path = pathname === "/" ? "" : pathname.replace(/\/$/u, "");
    return `${hostname.replace(/^www\./u, "")}${path}`;
  } catch {
    return url;
  }
}

function draftOf(brand: Brand) {
  return {
    description: brand.description,
    socials: brand.socials,
    title: brand.title,
    website: brand.website,
  };
}

/** The brand's own site, then its profiles elsewhere, as pills. */
function Links({ brand }: { brand: Brand }) {
  const links = [
    ...(brand.website ? [{ url: brand.website, website: true }] : []),
    ...brand.socials.map((url) => ({ url, website: false })),
  ];
  return (
    <ul className="flex flex-wrap gap-1.5">
      {links.map(({ url, website }) => {
        const platform = website ? "web" : platformOf(url);
        return (
          <li key={url}>
            <a
              className="bg-foreground/5 hover:bg-foreground/10 focus-visible:ring-ring/50 inline-flex h-8 max-w-64 items-center gap-2 rounded-full pr-3.5 pl-2.5 text-sm transition-colors duration-150 ease-out outline-none focus-visible:ring-3"
              href={url}
              rel="noopener noreferrer"
              target="_blank"
              title={
                platform === "web" ? url : `${platformName(platform)}: ${url}`
              }
            >
              <PlatformIcon platform={platform} />
              <span className="truncate">
                {website ? hostOf(url) : linkLabel(url)}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** The brand's site and profiles, changed in a popover. */
function LinksEditor({
  project,
  brand,
  hasLinks,
}: {
  project: Project;
  brand: Brand;
  hasLinks: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [website, setWebsite] = useState(brand.website);
  const [socials, setSocials] = useState(brand.socials.join("\n"));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await updateBrand(project, brand, {
      ...draftOf(brand),
      socials: socials.split(/\s+/u).filter(Boolean),
      website,
    });
    if (saved) {
      setOpen(false);
    }
  };

  return (
    <Popover
      onOpenChange={(next) => {
        if (next) {
          setWebsite(brand.website);
          setSocials(brand.socials.join("\n"));
        }
        setOpen(next);
      }}
      open={open}
    >
      <PopoverTrigger
        render={
          hasLinks ? (
            <Button aria-label="Edit links" size="icon-sm" variant="ghost" />
          ) : (
            <Button className="self-start" size="sm" variant="ghost" />
          )
        }
      >
        {hasLinks ? (
          <PencilIcon />
        ) : (
          <>
            <LinkIcon />
            Add website and profiles
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-website`}>Website</Label>
            <Input
              autoComplete="url"
              id={`${id}-website`}
              inputMode="url"
              onChange={(event) => setWebsite(event.target.value)}
              placeholder="https://example.com"
              value={website}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-socials`}>Profiles, one per line</Label>
            <Textarea
              className="min-h-24"
              id={`${id}-socials`}
              onChange={(event) => setSocials(event.target.value)}
              placeholder={"https://x.com/…\nhttps://primal.net/p/…"}
              rows={Math.min(
                MAX_SOCIALS,
                Math.max(3, socials.split("\n").length)
              )}
              value={socials}
            />
          </div>
          <Button className="self-end" size="sm" type="submit">
            Save
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Text edited in place, saved when it's left; Escape puts it back. */
function InlineText({
  value,
  label,
  placeholder,
  max,
  multiline = false,
  className,
  style,
  onSave,
}: {
  value: string;
  label: string;
  placeholder: string;
  max: number;
  multiline?: boolean;
  className: string;
  style?: CSSProperties;
  onSave: (value: string) => void;
}) {
  const [typed, setTyped] = useState<string>();
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      setTyped(undefined);
      event.currentTarget.blur();
    } else if (
      event.key === "Enter" &&
      !event.nativeEvent.isComposing &&
      !(multiline && event.shiftKey)
    ) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };
  return (
    <textarea
      aria-label={label}
      className={cn(
        "placeholder:text-muted-foreground/60 field-sizing-content w-full resize-none rounded-lg bg-transparent outline-none",
        "hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.03] -mx-2 px-2 transition-colors duration-150",
        className
      )}
      maxLength={max}
      onBlur={() => {
        if (typed !== undefined && typed.trim() !== value) {
          onSave(typed.trim());
        }
        setTyped(undefined);
      }}
      onChange={(event) =>
        setTyped(
          multiline
            ? event.target.value
            : event.target.value.replaceAll("\n", " ")
        )
      }
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      rows={1}
      style={style}
      value={typed ?? value}
    />
  );
}

/** The brand at a glance: its colors, mark and name, what it is and where it lives. */
export function BrandHero({
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
  const { heading, body } = textFonts(parts.fonts);
  const headingStyle = heading ? { fontFamily: cssFamily(heading) } : undefined;
  const bodyStyle = body ? { fontFamily: cssFamily(body) } : undefined;
  const hasLinks = brand.website !== "" || brand.socials.length > 0;
  const save = (changes: { title?: string; description?: string }) =>
    updateBrand(project, brand, { ...draftOf(brand), ...changes });

  return (
    <header className="bg-card shadow-surface overflow-hidden rounded-3xl">
      <BrandCover className="h-28 sm:h-36" parts={parts} />
      <div className="flex flex-col gap-4 px-5 pb-6 sm:px-8 sm:pb-8">
        <BrandMark
          brand={brand}
          className="ring-card -mt-10 size-20 rounded-[1.375rem] text-3xl ring-[6px] sm:-mt-12 sm:size-24 sm:rounded-[1.625rem]"
          parts={parts}
        />
        <div className="flex flex-col gap-1.5">
          {editable ? (
            <InlineText
              className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
              label="Name"
              max={MAX_BRAND_NAME}
              onSave={(title) => title && save({ title })}
              placeholder="Untitled"
              style={headingStyle}
              value={brand.title}
            />
          ) : (
            <h1
              className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
              style={headingStyle}
            >
              {brand.title}
            </h1>
          )}
          {editable ? (
            <InlineText
              className="text-muted-foreground max-w-2xl text-base text-pretty sm:text-lg"
              label="What it stands for"
              max={MAX_BRAND_DESCRIPTION}
              multiline
              onSave={(description) => save({ description })}
              placeholder="What it stands for, in a line or two"
              style={bodyStyle}
              value={brand.description}
            />
          ) : (
            brand.description && (
              <p
                className="text-muted-foreground max-w-2xl text-base text-pretty whitespace-pre-line sm:text-lg"
                style={bodyStyle}
              >
                {brand.description}
              </p>
            )
          )}
        </div>
        {(hasLinks || editable) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {hasLinks && <Links brand={brand} />}
            {editable && (
              <LinksEditor
                brand={brand}
                hasLinks={hasLinks}
                project={project}
              />
            )}
          </div>
        )}
      </div>
      {parts.colors.length > 0 && (
        <div aria-hidden className="flex h-1.5">
          {parts.colors.map((color) => (
            <span
              className="flex-1"
              key={color.id}
              style={{ background: color.hex }}
            />
          ))}
        </div>
      )}
    </header>
  );
}
