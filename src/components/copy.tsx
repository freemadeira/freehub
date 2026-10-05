import { CheckIcon, CopyIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const ICON_SWAP = {
  animate: { filter: "blur(0px)", opacity: 1, scale: 1 },
  exit: { filter: "blur(4px)", opacity: 0, scale: 0.25 },
  initial: { filter: "blur(4px)", opacity: 0, scale: 0.25 },
  transition: { bounce: 0, duration: 0.3, type: "spring" },
} as const;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    toast.error("Couldn’t copy to the clipboard.");
    return false;
  }
}

export function useCopy(): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async (text: string) => {
    setCopied(await copyText(text));
  };

  return { copied, copy };
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const { copied, copy } = useCopy();
  return (
    <Tooltip>
      <TooltipTrigger
        closeOnClick={false}
        render={
          <Button
            aria-label={label}
            onClick={() => copy(value)}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            className="flex"
            key={copied ? "copied" : "copy"}
            {...ICON_SWAP}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </motion.span>
        </AnimatePresence>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : label}</TooltipContent>
    </Tooltip>
  );
}
