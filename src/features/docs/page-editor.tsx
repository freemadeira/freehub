import type { Editor, Extensions } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import type { Node } from "@tiptap/pm/model";
import { EditorContent, useEditor } from "@tiptap/react";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Ref } from "react";
import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";

import { InternalLinks } from "@/components/markdown-editor/app-link";
import { replaceMarkdown, SHOWN } from "@/components/markdown-editor/apply";
import { MoveBlock } from "@/components/markdown-editor/block-actions";
import { BlockHandle } from "@/components/markdown-editor/block-handle";
import type {
  BlockCommand,
  BlockType,
  HeadingLevel,
} from "@/components/markdown-editor/blocks";
import { BLOCK_TYPES, INSERTS } from "@/components/markdown-editor/blocks";
import { MarkdownClipboard } from "@/components/markdown-editor/clipboard";
import type { MarkdownDialect } from "@/components/markdown-editor/content";
import {
  CONTENT,
  CONTENT_MARKDOWN,
} from "@/components/markdown-editor/content";
import {
  MentionCommand,
  MentionMenu,
  MentionMenuStore,
} from "@/components/markdown-editor/mention-menu";
import {
  RefCommand,
  RefMenu,
  RefMenuStore,
} from "@/components/markdown-editor/ref-menu";
import {
  SlashCommand,
  SlashMenu,
  SlashMenuStore,
} from "@/components/markdown-editor/slash-menu";
import {
  hideSelectionToolbar,
  LinkTarget,
  SelectionToolbar,
} from "@/components/markdown-editor/toolbar";
import { PageSync } from "@/features/docs/page-sync";
import { useProfileNames } from "@/hooks/use-profile-names";
import { onLeave } from "@/lib/leaving";
import { mentionNames } from "@/lib/mentions";

/** What a page's text holds, and what its editor offers to add. */
export interface PageSchema {
  /** The blocks and marks, as they show while editing. */
  extensions: Extensions;
  /** How the text reads and writes as Markdown. */
  markdown: MarkdownDialect;
  /** What the "/" menu and the block handle's "Turn into" offer. */
  types: readonly BlockType[];
  /** What else the "/" menu adds, before the page's own commands. */
  inserts: readonly BlockCommand[];
  /** The heading levels the selection toolbar offers. */
  headings: readonly HeadingLevel[];
}

/** A doc page: what descriptions hold, with links to the app opening in place. */
export const DOC_PAGE: PageSchema = {
  extensions: [...CONTENT, InternalLinks],
  headings: [1, 2, 3],
  inserts: INSERTS,
  markdown: CONTENT_MARKDOWN,
  types: BLOCK_TYPES,
};

export interface PageEditorHandle {
  /** Something besides the text changed, like the title: save it with the next save. */
  changed: () => void;
  /** Saves pending edits now. */
  save: () => void;
  /** The text as it stands, as Markdown, saved or not. */
  read: () => string;
  /** Puts the cursor at the start or the end of the text. */
  focus: (at: "start" | "end") => void;
}

interface PageEditorProps {
  /** The page's newest version when it opened. */
  opened: NostrEvent;
  /** Every member's newest version of the page, to merge as they arrive. */
  versions: NostrEvent[];
  pubkey: string;
  /** What the text holds: a doc page's unless given. */
  schema?: PageSchema;
  /** What the text is, for screen readers. */
  label?: string;
  /** People who can be mentioned. Without them, "@" is just text. */
  people?: string[];
  /** Address of the project whose things "#" offers to reference. Without it, "#" is just text. */
  project?: string;
  /**
   * Saves the text as a new version of the page, edited from `prev`.
   * `picked` are the people picked from the "@" list since the last save.
   */
  onPublish: (
    content: string,
    prev: NostrEvent,
    picked: ReadonlySet<string>
  ) => Promise<boolean>;
  /** More "/" commands, after the built-in blocks. */
  commands?: readonly BlockCommand[];
  ref?: Ref<PageEditorHandle>;
}

const PROMPT = "Press ‘/’ for commands…";
const NO_COMMANDS: readonly BlockCommand[] = [];

// The empty line with the cursor says what it is, or how to pick a block.
function placeholder({
  editor,
  node,
  pos,
}: {
  editor: Editor;
  node: Node;
  pos: number;
}) {
  if (node.type.name === "heading") {
    return `Heading ${node.attrs.level}`;
  }
  const atTop = editor.state.doc.resolve(pos).parent.type.name === "doc";
  return node.type.name === "paragraph" && atTop ? PROMPT : "";
}

/** A page's text as Notion-like blocks, saved as markdown while typing. */
export function PageEditor({
  opened,
  versions,
  pubkey,
  schema = DOC_PAGE,
  label = "Page",
  people,
  project,
  onPublish,
  commands = NO_COMMANDS,
  ref,
}: PageEditorProps) {
  const slash = useMemo(() => new SlashMenuStore(), []);
  const mentionMenu = useMemo(() => new MentionMenuStore(), []);
  const refMenu = useMemo(() => new RefMenuStore(), []);
  const mentioning = people !== undefined;
  const profileNames = useProfileNames(people ?? []);
  const names = mentionNames(people ?? [], profileNames);
  const toolbar = useRef<HTMLDivElement>(null);
  const sync = useRef<PageSync | null>(null);
  const publishRef = useRef(onPublish);
  const extensions = useMemo(
    () => [
      ...schema.extensions,
      MarkdownClipboard.configure({ markdown: schema.markdown }),
      LinkTarget,
      MoveBlock,
      SlashCommand.configure({ store: slash }),
      MentionCommand.configure({ store: mentioning ? mentionMenu : null }),
      RefCommand.configure({ store: project === undefined ? null : refMenu }),
      Placeholder.configure({ includeChildren: true, placeholder }),
    ],
    [schema, slash, mentioning, mentionMenu, project, refMenu]
  );

  const editor = useEditor({
    content: schema.markdown.parse(opened.content),
    editorProps: {
      attributes: {
        "aria-label": label,
        "aria-multiline": "true",
        class: "rich-text page-text",
        role: "textbox",
      },
    },
    extensions,
    onBlur: ({ event }) => {
      // Moving into the toolbar, to type a link or pick a style, is still editing.
      const next = event.relatedTarget;
      if (
        !(next instanceof globalThis.Node && toolbar.current?.contains(next))
      ) {
        sync.current?.save();
      }
    },
    onUpdate: ({ transaction }) => {
      // Teammates' edits shown in the text are theirs to save; the rest,
      // like a picture that finished uploading, is ours.
      if (!transaction.getMeta(SHOWN)) {
        sync.current?.changed();
      }
    },
  });

  useEffect(() => {
    publishRef.current = onPublish;
  });

  useEffect(() => {
    slash.setCommands([...schema.types, ...schema.inserts, ...commands]);
  }, [slash, schema, commands]);

  // Starts keeping the text and the relays in step, once the editor is up.
  const connect = useEffectEvent((current: Editor) => {
    const created = new PageSync(
      {
        busy: () => current.view.composing,
        me: pubkey,
        opened,
        publish: async (content, prev) => {
          // People picked from the "@" list since the last save: theirs are new mentions.
          const picked = mentionMenu.takePicked();
          const saved = await publishRef.current(content, prev, picked);
          // Not saved: they're still new mentions on the next try.
          if (!saved) {
            mentionMenu.addPicked(picked);
          }
          return saved;
        },
        read: () => schema.markdown.serialize(current.getJSON()),
        show: (markdown) => replaceMarkdown(current, markdown, schema.markdown),
      },
      versions
    );
    sync.current = created;
    return created;
  });
  useEffect(() => {
    if (!editor) {
      return;
    }
    const created = connect(editor);
    // Leaving the page or the app keeps what was typed.
    const keep = (event: BeforeUnloadEvent) => {
      if (created.dirty) {
        created.save();
        event.preventDefault();
      }
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") {
        created.save();
      }
    };
    addEventListener("beforeunload", keep);
    document.addEventListener("visibilitychange", hidden);
    const stop = onLeave(() => created.save());
    return () => {
      removeEventListener("beforeunload", keep);
      document.removeEventListener("visibilitychange", hidden);
      stop();
      created.save();
      created.dispose();
      sync.current = null;
    };
  }, [editor]);

  useEffect(() => {
    sync.current?.receive(versions);
  }, [versions]);

  useImperativeHandle(
    ref,
    () => ({
      changed: () => sync.current?.changed(true),
      focus: (at) => {
        if (!editor) {
          return;
        }
        const last = editor.state.doc.lastChild;
        const blank =
          last?.type.name === "paragraph" && last.content.size === 0;
        // As in Notion, carrying on after a heading, list or table starts a new line.
        if (at === "end" && !blank) {
          editor
            .chain()
            .insertContentAt(editor.state.doc.content.size, {
              type: "paragraph",
            })
            .focus("end")
            .run();
          return;
        }
        editor.chain().focus(at).run();
      },
      read: () =>
        editor ? schema.markdown.serialize(editor.getJSON()) : opened.content,
      save: () => sync.current?.save(),
    }),
    [editor, schema, opened]
  );

  return (
    <div className="page-editor relative">
      <EditorContent editor={editor} />
      {editor && (
        <>
          <BlockHandle editor={editor} types={schema.types} />
          <SlashMenu editor={editor} store={slash} />
          {mentioning && (
            <MentionMenu editor={editor} names={names} store={mentionMenu} />
          )}
          {project !== undefined && (
            <RefMenu editor={editor} project={project} store={refMenu} />
          )}
          <SelectionToolbar
            editor={editor}
            headings={schema.headings}
            onLeave={() => {
              hideSelectionToolbar(editor);
              sync.current?.save();
            }}
            ref={toolbar}
          />
        </>
      )}
    </div>
  );
}
