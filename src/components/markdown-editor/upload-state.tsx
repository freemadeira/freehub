import { RotateCwIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";

/** How far a picture got on its way up, or why it stopped, over the picture. */
export function UploadState({
  progress,
  error,
  onRetry,
  onRemove,
}: {
  progress: number;
  error?: string;
  onRetry: () => void;
  onRemove: () => void;
}) {
  if (error) {
    return (
      <div className="bg-background/85 absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg p-4 text-center backdrop-blur-sm">
        <p className="text-destructive text-sm">{error}</p>
        <div className="flex gap-2">
          <Button onClick={onRetry} size="sm" variant="outline">
            <RotateCwIcon />
            Try again
          </Button>
          <Button onClick={onRemove} size="sm" variant="ghost">
            <Trash2Icon />
            Remove
          </Button>
        </div>
      </div>
    );
  }
  const percent = Math.round(progress * 100);
  return (
    <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-xs font-medium text-white tabular-nums backdrop-blur-md">
      <div
        aria-hidden
        className="h-1 grow overflow-hidden rounded-full bg-white/25"
      >
        <div
          className="h-full rounded-full bg-white transition-[width] duration-200 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      {percent < 100 ? `${percent}%` : "Saving…"}
    </div>
  );
}
