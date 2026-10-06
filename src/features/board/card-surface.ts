/**
 * A draggable card on a board or pipeline. While one is dragged, dnd-kit
 * leaves a hidden copy where it will land; it shows here as an empty dashed
 * slot.
 */
export const CARD_SURFACE =
  "rounded-lg bg-card shadow-surface outline-none transition-shadow duration-150 [-webkit-touch-callout:none] hover:shadow-raised focus-visible:ring-3 focus-visible:ring-ring/50 data-dnd-dragging:shadow-raised data-dnd-placeholder:visible! data-dnd-placeholder:bg-foreground/[0.03] data-dnd-placeholder:shadow-none data-dnd-placeholder:outline-2 data-dnd-placeholder:-outline-offset-2 data-dnd-placeholder:outline-foreground/15 data-dnd-placeholder:outline-dashed data-dnd-placeholder:*:invisible";
