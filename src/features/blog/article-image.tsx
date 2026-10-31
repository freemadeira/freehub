import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import type { ReactNodeViewProps } from "@tiptap/react";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { cn } from "cn";
import { ImageIcon, RotateCwIcon, Trash2Icon } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useId, useState } from "react";

import { ArticleImage } from "@/components/markdown-editor/article";
import type { BlockCommand } from "@/components/markdown-editor/blocks";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import type { WebsiteConfig } from "@/config";
import {
  cancelImageUpload,
  markAsked,
  retryImageUpload,
  startImageUpload,
  useImageUpload,
} from "@/features/blog/image-uploads";

/** Where an article's pictures go. */
export interface ImageOptions {
  /** The website the pictures are published on. */
  website: Pick<WebsiteConfig, "media"> | null;
}

const ACCEPT = "image/*";

function imageFiles(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter((file) =>
    file.type.startsWith("image/")
  );
}

/** Each picture in the text still uploading, by its upload's id. */
function uploadsIn(doc: ProseMirrorNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    const id = node.attrs.upload;
    if (node.type.name === ArticleImage.name && typeof id === "string") {
      ids.add(id);
    }
  });
  return ids;
}

/**
 * The uploaded picture takes its address in the text, wherever it was moved
 * meanwhile, and its editor saves it, as it does any change that isn't a
 * teammate's.
 */
function finish(editor: Editor, id: string, url: string) {
  if (editor.isDestroyed) {
    return;
  }
  const { tr } = editor.state;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === ArticleImage.name && node.attrs.upload === id) {
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        src: url,
        upload: null,
      });
    }
  });
  if (tr.docChanged) {
    // Not undoable: undoing would leave a picture without an upload.
    editor.view.dispatch(tr.setMeta("addToHistory", false));
  }
}

/**
 * Puts the pictures in the text, at `at` or the selection, and starts
 * publishing them. Each shows its progress in its place, and the first asks
 * for its alt text.
 */
export function insertImages(
  editor: Editor,
  files: File[],
  { website }: ImageOptions,
  at?: number
): void {
  if (!website || files.length === 0) {
    return;
  }
  const nodes = files.map((file, index) => ({
    attrs: {
      upload: startImageUpload(
        file,
        website,
        { ask: index === 0 },
        (image, id) => finish(editor, id, image.url)
      ),
    },
    type: ArticleImage.name,
  }));
  const chain = editor.chain().focus();
  (at === undefined
    ? chain.insertContent(nodes)
    : chain.insertContentAt(at, nodes)
  ).run();
}

/** Opens the device's picker for pictures; resolves with none if it's closed. */
function pickImages(): Promise<File[]> {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ACCEPT;
  input.multiple = true;
  // oxlint-disable-next-line promise/avoid-new -- the file picker only tells what was picked through events
  return new Promise((resolve) => {
    input.addEventListener("change", () => resolve([...(input.files ?? [])]), {
      once: true,
    });
    input.addEventListener("cancel", () => resolve([]), { once: true });
    input.click();
  });
}

async function pickAndInsert(editor: Editor, options: ImageOptions) {
  insertImages(editor, await pickImages(), options);
}

/** The "/" menu's "Image": picks pictures from the device and puts them where the "/" was. */
export function imageCommand(options: ImageOptions): BlockCommand {
  return {
    icon: ImageIcon,
    id: "image",
    keywords: ["image", "picture", "photo", "upload", "img"],
    label: "Image",
    run: (chain, editor) => {
      pickAndInsert(editor, options);
      return chain;
    },
  };
}

const ALT_BUTTON =
  "absolute top-2 left-2 rounded-md px-1.5 py-0.5 text-xs font-semibold tracking-wide shadow-surface backdrop-blur-md transition-[opacity,background-color] duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** The picture's alt text, asked for when it's added and edited from the corner. */
function AltText({
  alt,
  ask,
  onChange,
}: {
  alt: string;
  /** Opens it at once, for a picture just added. */
  ask: boolean;
  onChange: (alt: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(ask);
  const [draft, setDraft] = useState(alt);
  const commit = () => {
    const next = draft.replaceAll(/\s+/gu, " ").trim();
    if (next !== alt) {
      onChange(next);
    }
  };
  const done = () => {
    commit();
    setOpen(false);
  };
  return (
    <Popover
      onOpenChange={(next) => {
        if (next) {
          setDraft(alt);
        } else {
          commit();
        }
        setOpen(next);
      }}
      open={open}
    >
      <PopoverTrigger
        aria-label={alt ? `Alt text: ${alt}` : "Add alt text"}
        className={cn(
          ALT_BUTTON,
          alt
            ? "bg-background/80 text-foreground opacity-0 group-hover/image:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100"
            : "bg-amber-300/90 text-amber-950"
        )}
      >
        {alt ? "ALT" : "+ ALT"}
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-80 flex-col gap-2">
        <Label htmlFor={id}>Alt text</Label>
        <Textarea
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened to type it
          autoFocus
          id={id}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              done();
            }
          }}
          placeholder="A fishing boat in Câmara de Lobos harbour at dusk"
          value={draft}
        />
        <p className="text-muted-foreground text-xs">
          Say what the picture shows, for people who can’t see it and for search
          engines.
        </p>
        <Button className="self-end" onClick={done} size="sm">
          Done
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** How far a picture got on its way to the media server, or why it stopped. */
function UploadState({
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

/** A picture in an article: uploading, or up, with its alt text and caption. */
function ImageView({
  node,
  editor,
  selected,
  updateAttributes,
  deleteNode,
}: ReactNodeViewProps) {
  const uploadId =
    typeof node.attrs.upload === "string" ? node.attrs.upload : null;
  const upload = useImageUpload(uploadId);
  const src: string | undefined = node.attrs.src ?? upload?.preview;
  const alt = String(node.attrs.alt ?? "");
  const caption = String(node.attrs.title ?? "");
  const editable = editor.isEditable;
  // A picture just added asks for its alt text, once.
  const ask = upload?.ask ?? false;
  useEffect(() => {
    if (ask && uploadId) {
      markAsked(uploadId);
    }
  }, [ask, uploadId]);

  return (
    <NodeViewWrapper as="figure" className="article-image">
      <div
        className={cn(
          "group/image relative overflow-hidden rounded-lg transition-shadow duration-150",
          selected && "ring-ring ring-offset-background ring-2 ring-offset-2"
        )}
        data-drag-handle=""
      >
        {src ? (
          <img
            alt={alt}
            className={cn(upload && !upload.error && "opacity-70")}
            draggable={false}
            src={src}
          />
        ) : (
          <div className="bg-muted text-muted-foreground flex aspect-video items-center justify-center rounded-lg text-sm">
            This picture didn’t finish uploading.
          </div>
        )}
        {upload && (
          <UploadState
            error={upload.error}
            onRemove={() => {
              cancelImageUpload(upload.id);
              deleteNode();
            }}
            onRetry={() => retryImageUpload(upload.id)}
            progress={upload.progress}
          />
        )}
        {editable && (
          <AltText
            alt={alt}
            ask={ask}
            onChange={(next) => updateAttributes({ alt: next })}
          />
        )}
      </div>
      {editable ? (
        <input
          aria-label="Caption"
          className="placeholder:text-muted-foreground/70 text-muted-foreground mt-2 w-full bg-transparent text-center text-sm outline-none"
          onChange={(event) => updateAttributes({ title: event.target.value })}
          onKeyDown={(event) => {
            // On to the text after the picture, as from the end of a line.
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              editor.commands.focus();
            }
          }}
          placeholder="Add a caption…"
          value={caption}
        />
      ) : (
        caption && <figcaption>{caption}</figcaption>
      )}
    </NodeViewWrapper>
  );
}

/**
 * The article's picture as the editor draws it: uploading in its place, with
 * its alt text and caption edited on it. Pictures pasted or dropped into the
 * text upload to the website's media server.
 */
export const EditableImage = ArticleImage.extend<ImageOptions>({
  addNodeView: () => ReactNodeViewRenderer(ImageView),
  addOptions: () => ({ website: null }),
  addProseMirrorPlugins() {
    const { editor, options } = this;
    return [
      new Plugin({
        props: {
          handleDrop: (view, event, _slice, moved) => {
            const files = moved ? [] : imageFiles(event.dataTransfer);
            if (files.length === 0) {
              return false;
            }
            event.preventDefault();
            const at = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            insertImages(editor, files, options, at?.pos);
            return true;
          },
          handlePaste: (_view, event) => {
            const files = imageFiles(event.clipboardData);
            if (files.length === 0) {
              return false;
            }
            insertImages(editor, files, options);
            return true;
          },
        },
        // A picture taken out of the text stops uploading, and all do with the editor.
        view: () => ({
          destroy: () => {
            for (const id of uploadsIn(editor.state.doc)) {
              cancelImageUpload(id);
            }
          },
          update: (view, before) => {
            if (view.state.doc === before.doc) {
              return;
            }
            const now = uploadsIn(view.state.doc);
            for (const id of uploadsIn(before.doc)) {
              if (!now.has(id)) {
                cancelImageUpload(id);
              }
            }
          },
        }),
      }),
    ];
  },
});
