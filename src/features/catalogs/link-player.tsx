import { cn } from "cn";
import { format, parseISO } from "date-fns";
import { ExternalLinkIcon, PlayIcon } from "lucide-react";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { useLinkPicture } from "@/features/catalogs/link-picture";
import { PlatformIcon } from "@/features/catalogs/platform-icon";
import type { Link } from "@/lib/catalogs";
import { hostOf, platformName, youtubeId } from "@/lib/catalogs";

/** A platform's own player for the link, in a frame, and its shape. */
interface Player {
  src: string;
  /** Width over height; missing for players that set their own height. */
  aspect?: number;
  /** Height in pixels, for those. */
  height?: number;
}

/** What Spotify and Instagram addresses hold, in the part of the path before its id. */
const SPOTIFY_KINDS = new Set([
  "track",
  "album",
  "playlist",
  "episode",
  "show",
  "artist",
]);
const INSTAGRAM_KINDS = new Set(["p", "reel", "tv"]);

function pathParts(url: string): string[] {
  try {
    return new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return [];
  }
}

/** The player each platform offers for embedding, when it offers one. */
export function playerOf(
  link: Pick<Link, "url" | "platform" | "type">
): Player | undefined {
  const parts = pathParts(link.url);
  switch (link.platform) {
    case "youtube": {
      const id = youtubeId(link.url);
      return id
        ? {
            aspect: link.type === "short" ? 9 / 16 : 16 / 9,
            // The privacy-enhanced player, which sets no cookies until it plays.
            src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`,
          }
        : undefined;
    }
    case "vimeo": {
      const id = parts.find((part) => /^\d+$/u.test(part));
      return id
        ? {
            aspect: 16 / 9,
            src: `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1`,
          }
        : undefined;
    }
    case "tiktok": {
      const at = parts.indexOf("video");
      const id = at === -1 ? undefined : parts[at + 1];
      return id
        ? {
            aspect: 9 / 16,
            src: `https://www.tiktok.com/player/v1/${id}?autoplay=1&rel=0`,
          }
        : undefined;
    }
    case "x": {
      const at = parts.indexOf("status");
      const id = at === -1 ? undefined : parts[at + 1];
      return id
        ? {
            height: 560,
            src: `https://platform.twitter.com/embed/Tweet.html?id=${id}&dnt=true&theme=dark`,
          }
        : undefined;
    }
    case "spotify": {
      const at = parts.findIndex((part) => SPOTIFY_KINDS.has(part));
      const id = at === -1 ? undefined : parts[at + 1];
      return id
        ? {
            height: 352,
            src: `https://open.spotify.com/embed/${parts[at]}/${id}?theme=0`,
          }
        : undefined;
    }
    case "instagram": {
      const at = parts.findIndex((part) => INSTAGRAM_KINDS.has(part));
      const id = at === -1 ? undefined : parts[at + 1];
      return id
        ? {
            aspect: 9 / 14,
            src: `https://www.instagram.com/${parts[at]}/${id}/embed/captioned/`,
          }
        : undefined;
    }
    default: {
      return undefined;
    }
  }
}

function OpenButton({
  link,
  variant = "secondary",
}: {
  link: Link;
  variant?: "secondary" | "ghost";
}) {
  return (
    <a
      className={buttonVariants({ variant })}
      href={link.url}
      rel="noopener noreferrer"
      target="_blank"
    >
      <ExternalLinkIcon />
      Open on{" "}
      {link.platform === "web" ? hostOf(link.url) : platformName(link.platform)}
    </a>
  );
}

/** The frame a player plays in, sized to fit what's around it at its own shape. */
function Frame({ player, title }: { player: Player; title: string }) {
  return (
    <iframe
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
      allowFullScreen
      className={cn(
        "max-h-full max-w-full rounded-xl bg-black",
        player.aspect ? "h-full" : "w-full max-w-xl"
      )}
      referrerPolicy="strict-origin-when-cross-origin"
      // Their own scripts, and their own site in a new tab; nothing more. They're
      // other sites' pages, so allowing their origin only lets them keep their own.
      // oxlint-disable-next-line react/iframe-missing-sandbox
      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
      src={player.src}
      style={
        player.aspect
          ? { aspectRatio: String(player.aspect) }
          : { height: player.height }
      }
      title={title}
    />
  );
}

/** The link's picture as large as fits, faded in once it loads. */
function FullThumb({ link }: { link: Link }) {
  const src = useLinkPicture(link);
  const [loaded, setLoaded] = useState(false);
  if (!src) {
    return null;
  }
  return (
    <img
      alt=""
      className={cn(
        "max-h-full max-w-full rounded-xl object-contain transition-opacity duration-300 ease-out",
        loaded ? "opacity-100" : "opacity-0"
      )}
      draggable={false}
      height={link.thumb?.height}
      onLoad={() => setLoaded(true)}
      referrerPolicy="no-referrer"
      src={src}
      width={link.thumb?.width}
    />
  );
}

/** What plays, rather than shows, in a platform's player. */
const PLAYS = new Set(["video", "short", "music", "podcast"]);

/**
 * A post's own words, large, with who wrote it: what the post says shows
 * at once, and the platform's own post loads only when asked for.
 */
function PostQuote({ link, onShow }: { link: Link; onShow: () => void }) {
  return (
    <figure className="flex w-full max-w-xl flex-col gap-5 rounded-3xl bg-white/5 p-8 ring-1 ring-white/10">
      <figcaption className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-full bg-white/10">
          <PlatformIcon className="size-4.5" platform={link.platform} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-white">
            {link.byline?.name ?? platformName(link.platform)}
          </span>
          {link.publishedAt && (
            <span className="text-xs text-white/60">
              {format(parseISO(link.publishedAt), "PP")}
            </span>
          )}
        </span>
      </figcaption>
      <blockquote className="text-lg leading-relaxed text-pretty whitespace-pre-line text-white/90">
        {link.excerpt}
      </blockquote>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onShow} variant="secondary">
          <PlayIcon className="fill-current" />
          Show the post
        </Button>
        <OpenButton link={link} variant="ghost" />
      </div>
    </figure>
  );
}

/**
 * What the link is, large: its picture, which plays it in the platform's
 * own player once pressed, so nothing loads from the platform until then;
 * a post's words; or the site, with a way out to it.
 */
export function LinkPlayer({ link }: { link: Link }) {
  const player = playerOf(link);
  const [playing, setPlaying] = useState(false);
  if (player && playing) {
    return (
      <div className="flex size-full items-center justify-center">
        <Frame player={player} title={link.title} />
      </div>
    );
  }
  const pictured = Boolean(link.thumb || link.image);
  if (player && !pictured && link.excerpt) {
    return <PostQuote link={link} onShow={() => setPlaying(true)} />;
  }
  if (player) {
    const plays = PLAYS.has(link.type);
    return (
      <button
        aria-label={`${plays ? "Play" : "Show"} on ${platformName(link.platform)}`}
        className="group/play focus-visible:ring-ring/50 relative flex size-full items-center justify-center rounded-xl outline-none focus-visible:ring-3"
        onClick={() => setPlaying(true)}
        type="button"
      >
        {pictured ? (
          <FullThumb link={link} />
        ) : (
          <span className="flex size-48 items-center justify-center rounded-3xl bg-white/5">
            <PlatformIcon className="size-14" platform={link.platform} />
          </span>
        )}
        <span className="absolute flex flex-col items-center gap-3">
          <span className="flex size-16 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-md transition-[scale,background-color] duration-200 ease-out group-hover/play:scale-105 group-hover/play:bg-black/70 group-active/play:scale-95">
            <PlayIcon className="size-7 translate-x-0.5 fill-current" />
          </span>
          <span className="rounded-full bg-black/55 px-2.5 py-1 text-xs text-white/85 backdrop-blur-md">
            {plays ? "Plays" : "Shows"} from {platformName(link.platform)}
          </span>
        </span>
      </button>
    );
  }
  if (pictured) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-4">
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          <FullThumb link={link} />
        </div>
        <OpenButton link={link} />
      </div>
    );
  }
  return (
    <div className="flex max-w-lg flex-col items-center gap-5 text-center">
      <span className="bg-card/10 flex size-20 items-center justify-center rounded-3xl">
        <PlatformIcon className="size-9" platform={link.platform} />
      </span>
      {link.excerpt && (
        <p className="text-base leading-relaxed text-pretty whitespace-pre-line text-white/90">
          {link.excerpt}
        </p>
      )}
      <OpenButton link={link} />
    </div>
  );
}
