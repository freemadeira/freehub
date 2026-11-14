import { cn } from "cn";
import { ZapIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { BrandCover, BrandMark } from "@/features/branding/brand-card";
import { BrandPicture, BrandSection } from "@/features/branding/brand-parts";
import type {
  Brand,
  BrandParts,
  HexColor,
  LogoKind,
  LogoMode,
} from "@/lib/brands";
import {
  cssFamily,
  INK,
  isLight,
  logoFor,
  PAPER,
  textFonts,
  textOn,
} from "@/lib/brands";
import { hostOf, platformOf } from "@/lib/catalogs";

/** Logos that fit a wide space, best first, and ones that fit a square. */
const WIDE: LogoKind[] = ["lockup", "wordmark", "symbol"];
const SQUARE: LogoKind[] = ["symbol", "icon", "lockup"];

/** What the mockups draw with: the brand's colors, type and logos, with sensible stand-ins. */
interface Kit {
  brand: Brand;
  parts: BrandParts;
  primary: HexColor;
  /** Text that reads on the primary color. */
  onPrimary: HexColor;
  heading?: CSSProperties;
  body?: CSSProperties;
  /** The brand's name as a handle: from a profile link, else its name run together. */
  handle: string;
}

/** A logo made for the background, or the brand's name set in its heading type instead. */
function LogoOn({
  kit,
  kinds,
  mode,
  className,
  textClassName,
}: {
  kit: Kit;
  kinds: LogoKind[];
  mode: LogoMode;
  className: string;
  textClassName: string;
}) {
  const logo = logoFor(kit.parts.files, kinds, mode);
  if (logo?.mode === mode) {
    return <BrandPicture className={className} file={logo.file} original />;
  }
  return (
    <span
      className={cn("truncate font-semibold tracking-tight", textClassName)}
      style={kit.heading}
    >
      {kit.brand.title}
    </span>
  );
}

function Stage({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="flex flex-col gap-2">
      <div className="bg-muted/70 flex min-h-80 items-center justify-center overflow-hidden rounded-2xl p-6">
        {children}
      </div>
      <figcaption className="text-muted-foreground px-1 text-xs">
        {label}
      </figcaption>
    </figure>
  );
}

/** The brand as a Nostr profile: its banner, picture, name and what it's about. */
function NostrProfile({ kit }: { kit: Kit }) {
  const { brand, parts } = kit;
  const host = brand.website ? hostOf(brand.website) : "";
  return (
    <div className="bg-card shadow-raised w-full max-w-72 overflow-hidden rounded-2xl">
      <BrandCover className="h-20" parts={parts} />
      <div className="flex flex-col gap-2 px-4 pb-4">
        <div className="flex items-end justify-between gap-2">
          <BrandMark
            brand={brand}
            className="ring-card -mt-7 size-14 rounded-full text-xl ring-4"
            parts={parts}
          />
          <span
            className="flex h-7 items-center gap-1 rounded-full px-3 text-xs font-semibold"
            style={{ background: kit.primary, color: kit.onPrimary }}
          >
            <ZapIcon aria-hidden className="size-3" />
            Zap
          </span>
        </div>
        <div className="flex min-w-0 flex-col">
          <span
            className="flex items-center gap-1 truncate leading-tight font-semibold"
            style={kit.heading}
          >
            {brand.title}
          </span>
          <span className="text-muted-foreground truncate text-xs">
            {host || kit.handle}
          </span>
        </div>
        {brand.description && (
          <p
            className="text-muted-foreground line-clamp-3 text-xs leading-relaxed"
            style={kit.body}
          >
            {brand.description}
          </p>
        )}
      </div>
    </div>
  );
}

function BusinessCards({ kit }: { kit: Kit }) {
  const { brand } = kit;
  const frontMode: LogoMode = isLight(kit.primary) ? "light" : "dark";
  const contact = [brand.website && hostOf(brand.website), kit.handle].filter(
    Boolean
  );
  return (
    // The front, in the brand's color, sits behind; the back with the details lies on top.
    <div className="relative aspect-[1/0.85] w-full max-w-80">
      <div
        className="shadow-raised absolute top-[2%] right-0 flex aspect-[1.75] w-[78%] rotate-6 items-center justify-center rounded-lg"
        style={{ background: kit.primary, color: kit.onPrimary }}
      >
        <LogoOn
          className="h-[38%] max-w-[50%]"
          kinds={SQUARE}
          kit={kit}
          mode={frontMode}
          textClassName="text-lg"
        />
      </div>
      <div
        className="shadow-raised absolute bottom-[2%] left-0 flex aspect-[1.75] w-[78%] -rotate-3 flex-col justify-between rounded-lg p-[6%]"
        style={{ background: PAPER, color: INK }}
      >
        <LogoOn
          className="h-6 max-w-[60%] self-start"
          kinds={WIDE}
          kit={kit}
          mode="light"
          textClassName="text-sm"
        />
        <div className="flex flex-col text-[9px] leading-snug" style={kit.body}>
          <span className="font-semibold">{brand.title}</span>
          {contact.map((line) => (
            <span className="truncate opacity-60" key={line}>
              {line}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Website({ kit }: { kit: Kit }) {
  const { brand, parts } = kit;
  const host = brand.website ? hostOf(brand.website) : "";
  const accent = parts.colors[1]?.hex ?? kit.primary;
  return (
    <div
      className="shadow-raised w-full max-w-80 overflow-hidden rounded-xl"
      style={{ background: PAPER, color: INK }}
    >
      <div className="flex h-7 items-center gap-1 bg-black/[0.04] px-2.5">
        {["#ff5f57", "#febc2e", "#28c840"].map((dot) => (
          <span
            className="size-2 rounded-full"
            key={dot}
            style={{ background: dot }}
          />
        ))}
        <span className="mx-auto h-4 w-1/2 truncate rounded-full bg-black/[0.05] px-2 text-center text-[8px] leading-4 text-black/50">
          {host || `${brand.title.toLowerCase().replaceAll(/\s+/gu, "")}.com`}
        </span>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <LogoOn
            className="h-4 max-w-[45%]"
            kinds={WIDE}
            kit={kit}
            mode="light"
            textClassName="text-xs"
          />
          <span
            className="flex gap-2 text-[8px] text-black/45"
            style={kit.body}
          >
            <span>About</span>
            <span>Work</span>
            <span>Contact</span>
          </span>
        </div>
        <div className="flex flex-col gap-1.5 pt-3">
          <span
            className="line-clamp-2 text-xl leading-tight font-semibold tracking-tight"
            style={kit.heading}
          >
            {brand.title}
          </span>
          {brand.description && (
            <span
              className="line-clamp-2 text-[10px] leading-relaxed text-black/55"
              style={kit.body}
            >
              {brand.description}
            </span>
          )}
        </div>
        <div className="flex gap-1.5 pt-1 pb-2" style={kit.body}>
          <span
            className="rounded-full px-3 py-1 text-[9px] font-semibold"
            style={{ background: kit.primary, color: kit.onPrimary }}
          >
            Get started
          </span>
          <span
            className="rounded-full border px-3 py-1 text-[9px] font-semibold"
            style={{ borderColor: `${accent}55`, color: accent }}
          >
            Learn more
          </span>
        </div>
      </div>
    </div>
  );
}

/** The handle a profile link gives, like `@freemadeira`, if it has one. */
function handleOf(url: string): string | undefined {
  try {
    const first = new URL(url).pathname.split("/").find(Boolean);
    return first && !first.includes(".")
      ? `@${first.replace(/^@/u, "")}`
      : undefined;
  } catch {
    return undefined;
  }
}

/** The brand put to work: a Nostr profile, business cards and a site, drawn from what it has now. */
export function MockupsSection({
  brand,
  parts,
}: {
  brand: Brand;
  parts: BrandParts;
}) {
  const { heading, body } = textFonts(parts.fonts);
  const primary = parts.colors[0]?.hex ?? INK;
  const profile = brand.socials.find(
    (link) => platformOf(link) !== "web" && handleOf(link)
  );
  const kit: Kit = {
    body: body ? { fontFamily: cssFamily(body) } : undefined,
    brand,
    handle:
      (profile && handleOf(profile)) ??
      `@${brand.title.toLowerCase().replaceAll(/[^\da-z]+/gu, "")}`,
    heading: heading ? { fontFamily: cssFamily(heading) } : undefined,
    onPrimary: textOn(primary),
    parts,
    primary,
  };
  return (
    <BrandSection id="in-use">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <Stage label="Nostr profile">
          <NostrProfile kit={kit} />
        </Stage>
        <Stage label="Business cards">
          <BusinessCards kit={kit} />
        </Stage>
        <Stage label="Website">
          <Website kit={kit} />
        </Stage>
      </div>
    </BrandSection>
  );
}
