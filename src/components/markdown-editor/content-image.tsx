import type { Editor } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import type { ImageOptions } from "@tiptap/extension-image";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { ReactNodeViewProps } from "@tiptap/react";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { cn } from "cn";
import { ImageIcon, ImageOffIcon } from "lucide-react";
import type { CSSProperties } from "react";

import type { BlockCommand } from "@/components/markdown-editor/blocks";
import { WebImage } from "@/components/markdown-editor/content";
import { UploadState } from "@/components/markdown-editor/upload-state";
import { hasBlossom } from "@/lib/blossom";
import { useOpened } from "@/lib/drive-files";
import type { ImageUpload } from "@/lib/image-uploads";
import {
  cancelImageUpload,
  retryImageUpload,
  startImageUpload,
  useImageUpload,
} from "@/lib/image-uploads";
import { uploadSealedImage } from "@/lib/sealed-image-upload";
import type { SealedImage } from "@/lib/sealed-images";
import { isSealedImageAddress, parseSealedImage } from "@/lib/sealed-images";

/** Marks the change that gives an uploaded image its address, so editors can save it. */
export const IMAGE_UPLOADED = "imageUploaded";

const ACCEPT = "image/*";

function imageFiles(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter((file) =>
    file.type.startsWith("image/")
  );
}

function isWebAddress(src: string): boolean {
  return /^https?:\/\//iu.test(src);
}

/** Each image in the text still uploading, by its upload's id. */
function uploadsIn(doc: ProseMirrorNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    const id = node.attrs.upload;
    if (node.type.name === WebImage.name && typeof id === "string") {
      ids.add(id);
    }
  });
  return ids;
}

/** Whether any image in the text is still uploading. */
export function hasUploads(doc: ProseMirrorNode): boolean {
  return uploadsIn(doc).size > 0;
}

/**
 * The uploaded image takes its address in the text, wherever it was moved
 * meanwhile, and its editor saves it.
 */
function finish(editor: Editor, id: string, src: string) {
  if (editor.isDestroyed) {
    return;
  }
  const { tr } = editor.state;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === WebImage.name && node.attrs.upload === id) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, src, upload: null });
    }
  });
  if (tr.docChanged) {
    // Not undoable: undoing would leave an image without an upload.
    editor.view.dispatch(
      tr.setMeta("addToHistory", false).setMeta(IMAGE_UPLOADED, true)
    );
  }
}

/** Puts the images in the text, at `at` or the selection, and starts uploading them. */
function insertImages(editor: Editor, files: File[], at?: number): void {
  if (files.length === 0 || !editor.isEditable) {
    return;
  }
  const nodes = files.map((file) => ({
    attrs: {
      upload: startImageUpload(
        file,
        uploadSealedImage,
        { ask: false },
        (src, id) => finish(editor, id, src)
      ),
    },
    type: WebImage.name,
  }));
  const chain = editor.chain().focus();
  (at === undefined
    ? chain.insertContent(nodes)
    : chain.insertContentAt(at, nodes)
  ).run();
}

/** Opens the device's picker for images; resolves with none if it's closed. */
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

async function pickAndInsert(editor: Editor) {
  insertImages(editor, await pickImages());
}

/** The "/" menu's "Image": picks images from the device and puts them where the "/" was. */
export const IMAGE_COMMAND: BlockCommand = {
  hidden: () => !hasBlossom(),
  icon: ImageIcon,
  id: "image",
  keywords: ["image", "picture", "photo", "upload", "img"],
  label: "Image",
  run: (chain, editor) => {
    pickAndInsert(editor);
    return chain;
  },
};

/** Room kept for an image while it opens, at its own size when that's known. */
function placeholderStyle(width?: number, height?: number): CSSProperties {
  return width && height
    ? { aspectRatio: `${width} / ${height}`, width }
    : { aspectRatio: "16 / 9", width: "16rem" };
}

/** Where an image is shown from, and whether it can't be. */
interface ImageSource {
  url?: string;
  sealed?: SealedImage;
  /** An address on the servers that can't be opened, or an upload that never finished. */
  broken: boolean;
}

/** The image's upload while it goes up, and where it's shown from. */
function useImageSource(
  src: string,
  uploadId: string | null
): ImageSource & { upload?: ImageUpload } {
  const upload = useImageUpload(uploadId);
  const sealed = uploadId ? undefined : parseSealedImage(src);
  const opened = useOpened(
    sealed && {
      blob: { hash: sealed.hash, nonce: sealed.nonce },
      key: sealed.key,
      type: sealed.type,
    }
  );
  if (upload) {
    return { broken: false, upload, url: upload.preview };
  }
  if (sealed) {
    return { broken: opened.error !== undefined, sealed, url: opened.url };
  }
  if (isWebAddress(src)) {
    return { broken: false, url: src };
  }
  return { broken: isSealedImageAddress(src) || uploadId !== null };
}

/** The room an image takes while it opens, or where it can't be. */
function ImagePlaceholder({
  sealed,
  broken,
  selected,
}: Pick<ImageSource, "sealed" | "broken"> & { selected: boolean }) {
  return (
    <span
      className={cn(
        "bg-muted text-muted-foreground inline-flex max-w-full items-center justify-center rounded-lg align-bottom",
        !broken && "animate-pulse",
        selected && "outline-ring outline-2 outline-offset-2"
      )}
      style={placeholderStyle(sealed?.width, sealed?.height)}
      title={broken ? "This image can’t be opened." : undefined}
    >
      {broken && <ImageOffIcon aria-hidden className="size-5" />}
    </span>
  );
}

/** An image in the text: uploading, opening from the team's servers, or from the web. */
function ContentImageView({ node, selected, deleteNode }: ReactNodeViewProps) {
  const uploadId =
    typeof node.attrs.upload === "string" ? node.attrs.upload : null;
  const { url, sealed, broken, upload } = useImageSource(
    String(node.attrs.src ?? ""),
    uploadId
  );
  return (
    <NodeViewWrapper
      as="span"
      className="content-image relative inline-block max-w-full align-bottom"
      data-drag-handle=""
    >
      {url ? (
        <img
          alt={String(node.attrs.alt ?? "")}
          className={cn(upload && !upload.error && "opacity-70")}
          draggable={false}
          height={sealed?.height}
          src={url}
          title={node.attrs.title ? String(node.attrs.title) : undefined}
          width={sealed?.width}
        />
      ) : (
        <ImagePlaceholder broken={broken} sealed={sealed} selected={selected} />
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
    </NodeViewWrapper>
  );
}

/**
 * Images as editors and viewers draw them: those on the team's Blossom
 * servers are fetched and opened in the browser, and one uploading shows
 * how far it got.
 */
export const ContentImage = WebImage.extend<ImageOptions>({
  addNodeView: () => ReactNodeViewRenderer(ContentImageView, { as: "span" }),
}).configure({ inline: true });

/**
 * Images pasted or dropped into the text are encrypted and uploaded to the
 * team's Blossom servers, showing their progress in place. One taken out of
 * the text stops uploading, and all do with the editor.
 */
export const ImageUploads = Extension.create({
  addProseMirrorPlugins() {
    const { editor } = this;
    if (!hasBlossom()) {
      return [];
    }
    return [
      new Plugin({
        key: new PluginKey("imageUploads"),
        props: {
          handleDrop: (view, event, _slice, moved) => {
            const files = moved ? [] : imageFiles(event.dataTransfer);
            if (files.length === 0 || !view.editable) {
              return false;
            }
            event.preventDefault();
            const at = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });
            insertImages(editor, files, at?.pos);
            return true;
          },
          handlePaste: (view, event) => {
            const files = imageFiles(event.clipboardData);
            if (files.length === 0 || !view.editable) {
              return false;
            }
            event.preventDefault();
            insertImages(editor, files);
            return true;
          },
        },
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
  name: "imageUploads",
  // Ahead of the markdown paste, which would take the file's name as text.
  priority: 102,
});
