import type { ReactElement } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/** Emoji for pages, roughly by what they're about. */
const ICONS = [
  "📄 📝 📌 📎 📚 📖 📒 📓 📋 🗂️ 📁 🗃️ 🗄️ 📊 📈 📉 🧾 🗒️ 🔖 🏷️",
  "💡 ✅ ☑️ ⭐ 🎯 🚀 ⚡ 🔥 ✨ 🧭 🗺️ 🧩 🔑 🔒 🛠️ ⚙️ 🧪 🔍 📣 🧱",
  "👋 🤝 👥 🧑‍💻 🙋 🎓 🏆 🎉 💬 📞 ✉️ 📅 ⏰ 🕒 🗓️ 🧠 ❤️ 🌱 🌍 🌟",
  "🏪 🏬 🏢 🏦 🏠 🏝️ 🌊 ⛰️ ☕ 🍽️ 🛒 🛍️ 💰 💳 🪙 💸 🧮 🏧 📦 🚚",
].flatMap((row) => row.split(" "));

function Picker({ onPick }: { onPick: (icon: string) => void }) {
  return (
    <div className="grid grid-cols-10 gap-0.5">
      {ICONS.map((icon) => (
        <button
          aria-label={icon}
          className="hover:bg-accent focus-visible:bg-accent flex size-8 items-center justify-center rounded-lg text-xl leading-none transition-colors duration-150 outline-none"
          key={icon}
          onClick={() => onPick(icon)}
          type="button"
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

/** Picks the emoji shown with a page, or takes it away. */
export function IconPicker({
  icon,
  onChange,
  trigger,
}: {
  icon: string;
  onChange: (icon: string) => void;
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" className="flex w-auto flex-col gap-2 p-2">
        {icon && (
          <Button
            className="self-end"
            onClick={() => pick("")}
            size="sm"
            variant="ghost"
          >
            Remove
          </Button>
        )}
        <Picker onPick={pick} />
      </PopoverContent>
    </Popover>
  );
}
