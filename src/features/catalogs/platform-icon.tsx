/**
 * Where a link is from, as its platform's icon. Icons come from svgl.app
 * (https://svgl.app), kept here so nothing is fetched to show them; ones
 * drawn in black or white have one for each theme.
 */
import { cn } from "cn";
import { GlobeIcon } from "lucide-react";

import { platformName } from "@/lib/catalogs";

import bluesky from "./platforms/bluesky.svg";
import facebook from "./platforms/facebook.svg";
import githubDark from "./platforms/github-dark.svg";
import github from "./platforms/github.svg";
import instagram from "./platforms/instagram.svg";
import linkedin from "./platforms/linkedin.svg";
import pinterest from "./platforms/pinterest.svg";
import reddit from "./platforms/reddit.svg";
import soundcloudDark from "./platforms/soundcloud-dark.svg";
import soundcloud from "./platforms/soundcloud.svg";
import spotify from "./platforms/spotify.svg";
import threadsDark from "./platforms/threads-dark.svg";
import threads from "./platforms/threads.svg";
import tiktokDark from "./platforms/tiktok-dark.svg";
import tiktok from "./platforms/tiktok.svg";
import twitch from "./platforms/twitch.svg";
import xDark from "./platforms/x-dark.svg";
import x from "./platforms/x.svg";
import youtube from "./platforms/youtube.svg";

/** Drawn for light backgrounds, and for dark ones when it differs. */
const ICONS: Record<string, { light: string; dark?: string }> = {
  bluesky: { light: bluesky },
  facebook: { light: facebook },
  github: { dark: githubDark, light: github },
  instagram: { light: instagram },
  linkedin: { light: linkedin },
  pinterest: { light: pinterest },
  reddit: { light: reddit },
  soundcloud: { dark: soundcloudDark, light: soundcloud },
  spotify: { light: spotify },
  threads: { dark: threadsDark, light: threads },
  tiktok: { dark: tiktokDark, light: tiktok },
  twitch: { light: twitch },
  x: { dark: xDark, light: x },
  youtube: { light: youtube },
};

/** Platforms without an icon here, drawn as their initial on their color. */
const COLORS: Record<string, string> = {
  medium: "#000000",
  nostr: "#8e30eb",
  substack: "#ff6719",
  vimeo: "#17d5ff",
};

/** Where a link is from, as its platform's icon, or a globe for anywhere else. */
export function PlatformIcon({
  platform,
  className,
}: {
  platform: string;
  className?: string;
}) {
  const icon = ICONS[platform];
  if (icon) {
    return (
      <>
        <img
          alt=""
          className={cn(
            "size-4 shrink-0 object-contain",
            icon.dark && "dark:hidden",
            className
          )}
          draggable={false}
          src={icon.light}
        />
        {icon.dark && (
          <img
            alt=""
            className={cn(
              "hidden size-4 shrink-0 object-contain dark:block",
              className
            )}
            draggable={false}
            src={icon.dark}
          />
        )}
      </>
    );
  }
  const color = COLORS[platform];
  if (color) {
    return (
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full text-[0.6em] leading-none font-bold text-white",
          className
        )}
        style={{ background: color }}
      >
        {platformName(platform).charAt(0)}
      </span>
    );
  }
  return (
    <GlobeIcon
      aria-hidden
      className={cn("text-muted-foreground size-4 shrink-0", className)}
    />
  );
}
