import { BehaviorSubject } from "rxjs";

import { readStorage, writeStorage } from "@/lib/utils";

export type Theme = "light" | "dark" | "system";

const THEME_KEY = "theme";
const INK = "#090506";
const WHITE = "#ffffff";

const media = window.matchMedia("(prefers-color-scheme: dark)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function savedTheme(): Theme {
  const saved = readStorage(THEME_KEY);
  return saved === "light" || saved === "dark" ? saved : "system";
}

export const theme$ = new BehaviorSubject<Theme>(savedTheme());

function isDark(theme: Theme): boolean {
  return theme === "dark" || (theme === "system" && media.matches);
}

function apply(theme: Theme): void {
  const dark = isDark(theme);
  const freeze = document.createElement("style");
  freeze.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.append(freeze);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  window.getComputedStyle(document.body);
  requestAnimationFrame(() => freeze.remove());
}

function origin(event: Event): [number, number] {
  // Keyboard presses arrive as synthetic clicks with no pointer position.
  if (event instanceof MouseEvent && event.isTrusted) {
    return [event.clientX, event.clientY];
  }
  const { x, y, width, height } = (
    event.target as Element
  ).getBoundingClientRect();
  return [x + width / 2, y + height / 2];
}

async function reveal(
  transition: ViewTransition,
  [x, y]: [number, number]
): Promise<void> {
  try {
    await transition.ready;
  } catch {
    return;
  }
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );
  document.documentElement.animate(
    {
      clipPath: [
        `circle(0 at ${x}px ${y}px)`,
        `circle(${radius}px at ${x}px ${y}px)`,
      ],
    },
    {
      duration: 400,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
      pseudoElement: "::view-transition-new(root)",
    }
  );
}

/** Spreads the new theme out from where it was picked. */
export function setTheme(theme: Theme, event: Event): void {
  writeStorage(THEME_KEY, theme === "system" ? null : theme);
  theme$.next(theme);
  const changed =
    isDark(theme) !== document.documentElement.classList.contains("dark");
  if (!(changed && "startViewTransition" in document)) {
    apply(theme);
    return;
  }
  const transition = document.startViewTransition(() => apply(theme));
  if (!reducedMotion.matches) {
    reveal(transition, origin(event));
  }
}

export function startTheme(): void {
  apply(theme$.value);
  media.addEventListener("change", () => {
    if (theme$.value === "system") {
      apply("system");
    }
  });
}

function rgb(color: string): [number, number, number] | undefined {
  const context = document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true });
  if (!context) {
    return undefined;
  }
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
  return [red, green, blue];
}

function luminance([red, green, blue]: [number, number, number]): number {
  const [r = 0, g = 0, b = 0] = [red, green, blue].map((value) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Uses the org accent for primary surfaces, with whichever text color reads better on it. */
export function applyAccent(color: string | undefined): void {
  if (!(color && CSS.supports("color", color))) {
    return;
  }
  const channels = rgb(color);
  if (!channels) {
    return;
  }
  const light = luminance(channels);
  const inkContrast = (light + 0.05) / (luminance([9, 5, 6]) + 0.05);
  const whiteContrast = 1.05 / (light + 0.05);
  const root = document.documentElement.style;
  root.setProperty("--primary", color);
  root.setProperty(
    "--primary-foreground",
    inkContrast >= whiteContrast ? INK : WHITE
  );
}
