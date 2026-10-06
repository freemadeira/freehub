/**
 * Grouped tooltip: one popup shared by related triggers, so moving between
 * them slides the content over instead of closing and reopening.
 * Adapted from Sona UI's fluid-tooltip (MIT) to match the app's tooltip look.
 */
import { Tooltip } from "@base-ui/react/tooltip";
import { cn } from "cn";
import type { ReactElement, ReactNode, RefObject } from "react";
import {
  createContext,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

type FluidTooltipSide = "top" | "right" | "bottom" | "left";
type FluidTooltipAlign = "start" | "center" | "end";

interface FluidTooltipContentState {
  children: ReactNode;
  className?: string;
  showArrow: boolean;
}

interface FluidTooltipPayload {
  // A ref so a trigger can open before its sibling Content has rendered.
  content: RefObject<FluidTooltipContentState>;
  side: FluidTooltipSide;
  align: FluidTooltipAlign;
  sideOffset: number;
}

interface FluidTooltipGroupContextValue {
  handle: Tooltip.Handle<FluidTooltipPayload>;
  disabled: boolean;
  defaultSide: FluidTooltipSide;
}

interface FluidTooltipRootContextValue {
  payload: FluidTooltipPayload;
  disabled: boolean;
  setContent: (content: FluidTooltipContentState) => void;
}

const GroupContext = createContext<FluidTooltipGroupContextValue | null>(null);
const RootContext = createContext<FluidTooltipRootContextValue | null>(null);

function useGroupContext(component: string) {
  const context = use(GroupContext);
  if (!context) {
    throw new Error(`${component} must be used inside FluidTooltip.Group.`);
  }
  return context;
}

function useRootContext(component: string) {
  const context = use(RootContext);
  if (!context) {
    throw new Error(`${component} must be used inside FluidTooltip.Root.`);
  }
  return context;
}

/** Whether the caller renders inside a FluidTooltip.Group. */
export function useInFluidTooltipGroup() {
  return use(GroupContext) !== null;
}

interface FluidTooltipGroupProps {
  children: ReactNode;
  /** Vertical groups default the tooltip to the right side. */
  orientation?: "horizontal" | "vertical";
  /** Delay before the first tooltip opens, in milliseconds. */
  openDelay?: number;
  /** Grace period before the tooltip closes, in milliseconds. */
  closeDelay?: number;
  disabled?: boolean;
  /** Extra classes for the shared tooltip surface. */
  className?: string;
}

function FluidTooltipGroup({
  children,
  orientation = "horizontal",
  openDelay = 350,
  closeDelay = 100,
  disabled = false,
  className,
}: FluidTooltipGroupProps) {
  const handle = useMemo(() => Tooltip.createHandle<FluidTooltipPayload>(), []);
  const context = useMemo<FluidTooltipGroupContextValue>(
    () => ({
      defaultSide: orientation === "vertical" ? "right" : "top",
      disabled,
      handle,
    }),
    [disabled, handle, orientation]
  );

  return (
    <Tooltip.Provider closeDelay={closeDelay} delay={openDelay} timeout={50}>
      <GroupContext value={context}>{children}</GroupContext>
      <Tooltip.Root disabled={disabled} handle={handle}>
        {({ payload }) => {
          if (!payload) {
            return null;
          }
          const content = payload.content.current;
          return (
            <Tooltip.Portal>
              <Tooltip.Positioner
                align={payload.align}
                className="isolate z-50 h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-[top,left,right,bottom,transform] duration-200 ease-out data-instant:transition-none"
                collisionPadding={8}
                side={payload.side}
                sideOffset={payload.sideOffset}
              >
                <Tooltip.Popup
                  className={cn(
                    "bg-foreground text-background relative h-(--popup-height,auto) w-(--popup-width,auto) max-w-(--available-width) origin-(--transform-origin) rounded-lg text-xs",
                    "transition-[width,height,scale,translate,opacity] duration-200 ease-out data-instant:transition-none",
                    "data-starting-style:translate-y-1 data-starting-style:scale-[0.96] data-starting-style:opacity-0",
                    "data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:duration-100",
                    className,
                    content.className
                  )}
                >
                  <Tooltip.Viewport
                    className={cn(
                      "relative size-full overflow-clip px-2.5 py-1",
                      // The outgoing label vanishes; the incoming one slides
                      // in from the side the pointer came from.
                      "[&_[data-previous]]:pointer-events-none [&_[data-previous]]:w-[calc(var(--popup-width)-1.25rem)] [&_[data-previous]]:opacity-0 [&_[data-previous]]:transition-none",
                      "[&_[data-current]]:w-[calc(var(--popup-width)-1.25rem)] [&_[data-current]]:transition-[translate,opacity] [&_[data-current]]:duration-[200ms,120ms] data-instant:[&_[data-current]]:transition-none",
                      "[&_[data-current][data-starting-style]]:opacity-0",
                      "data-[activation-direction~='left']:[&_[data-current][data-starting-style]]:-translate-x-2",
                      "data-[activation-direction~='right']:[&_[data-current][data-starting-style]]:translate-x-2",
                      "data-[activation-direction~='up']:[&_[data-current][data-starting-style]]:-translate-y-2",
                      "data-[activation-direction~='down']:[&_[data-current][data-starting-style]]:translate-y-2"
                    )}
                  >
                    {content.children}
                  </Tooltip.Viewport>
                  {content.showArrow && (
                    <Tooltip.Arrow className="bg-foreground absolute size-2 rotate-45 data-[side=bottom]:-top-1 data-[side=left]:-right-1 data-[side=right]:-left-1 data-[side=top]:-bottom-1" />
                  )}
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          );
        }}
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

interface FluidTooltipRootProps {
  children: ReactNode;
  /** Overrides the group's default side. */
  side?: FluidTooltipSide;
  align?: FluidTooltipAlign;
  sideOffset?: number;
  /** Disables this tooltip without disabling its trigger. */
  disabled?: boolean;
}

function FluidTooltipRoot({
  children,
  side,
  align = "center",
  sideOffset = 6,
  disabled = false,
}: FluidTooltipRootProps) {
  const group = useGroupContext("FluidTooltip.Root");
  const content = useRef<FluidTooltipContentState>({
    children: null,
    showArrow: false,
  });
  const setContent = useCallback((next: FluidTooltipContentState) => {
    content.current = next;
  }, []);
  const resolvedSide = side ?? group.defaultSide;
  const context = useMemo<FluidTooltipRootContextValue>(
    () => ({
      disabled,
      payload: { align, content, side: resolvedSide, sideOffset },
      setContent,
    }),
    [align, disabled, resolvedSide, setContent, sideOffset]
  );
  return <RootContext value={context}>{children}</RootContext>;
}

interface FluidTooltipTriggerProps {
  /** The button or link that triggers the tooltip; rendered as-is. */
  children: ReactElement;
  /** Keeps the tooltip open when the trigger is clicked. */
  keepOpenOnClick?: boolean;
}

function FluidTooltipTrigger({
  children,
  keepOpenOnClick = false,
}: FluidTooltipTriggerProps) {
  const group = useGroupContext("FluidTooltip.Trigger");
  const root = useRootContext("FluidTooltip.Trigger");
  return (
    <Tooltip.Trigger
      closeOnClick={!keepOpenOnClick}
      disabled={group.disabled || root.disabled}
      handle={group.handle}
      payload={root.payload}
      render={children}
    />
  );
}

interface FluidTooltipContentProps {
  /** Short, non-interactive label. */
  children: ReactNode;
  /** Extra classes for the surface while this tooltip shows. */
  className?: string;
  showArrow?: boolean;
}

function FluidTooltipContent({
  children,
  className,
  showArrow = false,
}: FluidTooltipContentProps) {
  const { setContent } = useRootContext("FluidTooltip.Content");
  useLayoutEffect(() => {
    setContent({ children, className, showArrow });
  }, [children, className, setContent, showArrow]);
  return null;
}

export const FluidTooltip = {
  Content: FluidTooltipContent,
  Group: FluidTooltipGroup,
  Root: FluidTooltipRoot,
  Trigger: FluidTooltipTrigger,
};
