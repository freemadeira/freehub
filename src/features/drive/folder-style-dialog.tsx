import { cn } from "cn";
import { useId, useState } from "react";

import { ColorPicker } from "@/components/color-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FolderIcon } from "@/features/drive/file-icon";
import type { DriveFolder } from "@/lib/drive";
import { updateFolder } from "@/lib/drive-actions";
import type { Color } from "@/lib/palette";
import type { Project } from "@/lib/project";

/** Emoji for folders, roughly by what they hold. */
const EMOJI = [
  "📁 📂 🗂️ 📦 🗃️ 🗄️ 📚 📖 📝 📄 📑 🧾 📊 📈 💼 🏷️ 🔖 📌 📎 🗓️",
  "📷 🎞️ 🎬 🎥 🎨 🖼️ 🎵 🎧 🎙️ 🎤 🖌️ ✏️ 🧩 💡 🚀 ⭐ 🔥 ✨ 🎯 🏆",
  "💰 💳 🧮 🏦 🧑‍💻 💻 🖥️ 🛠️ ⚙️ 🔒 🔑 🧪 📣 💬 ✉️ 📞 🤝 👥 🌍 ❤️",
].flatMap((row) => row.split(" "));

function StyleForm({
  project,
  folder,
  onDone,
}: {
  project: Project;
  folder: DriveFolder;
  onDone: () => void;
}) {
  const [color, setColor] = useState<Color>(folder.color ?? "blue");
  const [icon, setIcon] = useState(folder.icon ?? "");
  const colorLabel = useId();
  const save = () => {
    updateFolder(project, folder, {
      color: color === "blue" ? null : color,
      icon: icon || null,
    });
    onDone();
  };
  return (
    <>
      <div className="bg-muted/60 flex items-center justify-center rounded-2xl py-6">
        <FolderIcon folder={{ color, icon: icon || undefined }} size="xl" />
      </div>
      <div className="flex flex-col gap-2">
        <span
          className="text-muted-foreground text-xs font-medium"
          id={colorLabel}
        >
          Color
        </span>
        <ColorPicker
          aria-labelledby={colorLabel}
          onChange={setColor}
          value={color}
        />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex h-6 items-center justify-between">
          <span className="text-muted-foreground text-xs font-medium">
            Emoji
          </span>
          {icon && (
            <Button onClick={() => setIcon("")} size="xs" variant="ghost">
              Remove
            </Button>
          )}
        </div>
        <div className="grid grid-cols-10 gap-0.5">
          {EMOJI.map((item) => (
            <button
              aria-label={item}
              aria-pressed={icon === item}
              className={cn(
                "hover:bg-accent focus-visible:bg-accent flex aspect-square items-center justify-center rounded-lg text-xl leading-none transition-colors duration-150 outline-none",
                icon === item && "bg-primary/15 hover:bg-primary/20"
              )}
              key={item}
              onClick={() => setIcon(icon === item ? "" : item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <DialogFooter>
        <Button onClick={onDone} variant="outline">
          Cancel
        </Button>
        <Button onClick={save}>Save</Button>
      </DialogFooter>
    </>
  );
}

/** Picks a folder's color and the emoji on it. */
export function FolderStyleDialog({
  project,
  folder,
  onOpenChange,
}: {
  project: Project;
  folder: DriveFolder | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={folder !== undefined}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="truncate">{folder?.name}</DialogTitle>
        </DialogHeader>
        {folder && (
          <StyleForm
            folder={folder}
            key={folder.id}
            onDone={() => onOpenChange(false)}
            project={project}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
