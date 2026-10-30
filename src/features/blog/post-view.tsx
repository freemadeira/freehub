import type { NostrEvent } from "applesauce-core/helpers/event";
import { unixNow } from "applesauce-core/helpers/time";
import { cn } from "cn";
import { format, fromUnixTime } from "date-fns";
import {
  EllipsisIcon,
  EyeIcon,
  LinkIcon,
  NewspaperIcon,
  PencilIcon,
  SquareArrowOutUpRightIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import type { ChangeEvent, KeyboardEvent, ReactNode } from "react";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import { appPath } from "@/components/app-link";
import { copyText } from "@/components/copy";
import { IconButton } from "@/components/icon-button";
import {
  ARTICLE_HEADINGS,
  ARTICLE_MARKDOWN,
  articleWith,
} from "@/components/markdown-editor/article";
import {
  ARTICLE_BLOCK_TYPES,
  INSERTS,
} from "@/components/markdown-editor/blocks";
import { ProjectAvatar } from "@/components/project-avatar";
import { ago } from "@/components/timeline";
import type { Crumb } from "@/components/top-bar";
import { TopBar } from "@/components/top-bar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { WebsiteConfig } from "@/config";
import type { ImageOptions } from "@/features/blog/article-image";
import { EditableImage, imageCommand } from "@/features/blog/article-image";
import {
  blogPath,
  languageName,
  postName,
  postPath,
  STATUS_DOTS,
  STATUS_LABELS,
} from "@/features/blog/blog-context";
import { useUploadsWaiting } from "@/features/blog/image-uploads";
import { PostPreview } from "@/features/blog/post-preview";
import type { TypedFields } from "@/features/blog/post-settings";
import { PostSettings } from "@/features/blog/post-settings";
import type { PageEditorHandle, PageSchema } from "@/features/docs/page-editor";
import { PageEditor } from "@/features/docs/page-editor";
import type {
  BlogContent,
  ImageMeta,
  Post,
  PostFields,
  PostLanguage,
  SharedFields,
} from "@/lib/blog";
import {
  currentVersion,
  followTitle,
  languageStatus,
  postUrl,
  publishProblem,
  startLanguage,
  wasPublished,
  withShared,
} from "@/lib/blog";
import {
  deletePost,
  isDiscarded,
  knownImages,
  openLanguage,
  publishLanguage,
  saveDraft,
  unpublishLanguage,
  updateShared,
} from "@/lib/blog-actions";
import { canEdit, POST_DRAFT_KIND } from "@/lib/model";
import type { Project } from "@/lib/project";

const TITLE = "text-3xl leading-tight font-bold tracking-tight sm:text-4xl";

interface PostViewProps {
  project: Project;
  website: WebsiteConfig;
  blog: BlogContent;
  post: Post;
  pubkey: string;
}

/** What a language not written yet opens from: nothing, by whoever starts it. */
function blankVersion(pubkey: string): NostrEvent {
  return {
    content: "",
    created_at: 0,
    id: "draft-blank",
    kind: POST_DRAFT_KIND,
    pubkey,
    sig: "",
    tags: [],
  };
}

/** What an article's text holds, with pictures uploading to the website. */
function articleSchema(options: ImageOptions): PageSchema {
  return {
    extensions: articleWith(EditableImage.configure(options)),
    headings: ARTICLE_HEADINGS,
    inserts: [...INSERTS, imageCommand(options)],
    markdown: ARTICLE_MARKDOWN,
    types: ARTICLE_BLOCK_TYPES,
  };
}

function crumbsFor(project: Project, post: Post): Crumb[] {
  return [
    {
      href: `/p/${project.slug}`,
      icon: <ProjectAvatar project={project} />,
      label: project.title,
    },
    {
      href: blogPath(project),
      icon: <NewspaperIcon className="text-muted-foreground size-4 shrink-0" />,
      label: "Blog",
    },
    { label: postName(post) || "Untitled" },
  ];
}

/** Where a language stands: a dot and words, with when it was last published. */
function StatusLine({ language }: { language?: PostLanguage }) {
  const status = language ? languageStatus(language) : "draft";
  const published = language?.published;
  return (
    <p className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", STATUS_DOTS[status])}
      />
      <span className="truncate">
        {language ? STATUS_LABELS[status] : "Not written yet"}
        {published && (
          <>
            {" · "}
            <time
              dateTime={fromUnixTime(published.updatedAt).toISOString()}
              title={format(fromUnixTime(published.updatedAt), "PPpp")}
            >
              published {ago(published.updatedAt).toLowerCase()}
            </time>
          </>
        )}
      </span>
    </p>
  );
}

/** The post's ⋯ menu: its link in the app, and deleting it. */
function PostMenu({
  project,
  post,
  editable,
}: {
  project: Project;
  post: Post;
  editable: boolean;
}) {
  const [, navigate] = useLocation();
  const [confirming, setConfirming] = useState(false);
  const published = post.languages.filter((language) => language.published);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton label="Post options">
              <EllipsisIcon />
            </IconButton>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={async () => {
              const path = postPath(project, post, postName(post));
              if (await copyText(`${globalThis.location.origin}${path}`)) {
                toast.success("Link copied");
              }
            }}
          >
            <LinkIcon />
            Copy link
          </DropdownMenuItem>
          {editable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setConfirming(true)}
                variant="destructive"
              >
                <Trash2Icon />
                Delete post
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog onOpenChange={setConfirming} open={confirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {postName(post) || "this post"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {published.length > 0
                ? "It comes off the website in every language, and its drafts disappear for everyone in the project."
                : "Its drafts disappear for everyone in the project."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                navigate(blogPath(project), { replace: true });
                deletePost(project, post);
              }}
              variant="destructive"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface PublishBarProps {
  website: WebsiteConfig;
  locale: string;
  language?: PostLanguage;
  tabs: ReactNode;
  previewing: boolean;
  /** Why the language can't be published now, if it can't. */
  problem?: string;
  onPreview: () => void;
  onSettings: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
}

/** Above the text: the languages, where this one stands, and publishing it. */
function PublishBar({
  website,
  locale,
  language,
  tabs,
  previewing,
  problem,
  onPreview,
  onSettings,
  onPublish,
  onUnpublish,
}: PublishBarProps) {
  const published = language?.published;
  return (
    <div className="bg-background/85 sticky top-14 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 backdrop-blur-md sm:px-6">
      {tabs}
      <StatusLine language={language} />
      <div className="ml-auto flex items-center gap-1">
        {published && (
          <a
            className={buttonVariants({ size: "sm", variant: "ghost" })}
            href={postUrl(website, locale, published.slug)}
            rel="noopener noreferrer"
            target="_blank"
          >
            <SquareArrowOutUpRightIcon />
            View on site
          </a>
        )}
        <Button
          aria-pressed={previewing}
          onClick={onPreview}
          size="sm"
          variant="ghost"
        >
          {previewing ? <PencilIcon /> : <EyeIcon />}
          {previewing ? "Edit" : "Preview"}
        </Button>
        <IconButton className="lg:hidden" label="Settings" onClick={onSettings}>
          <SlidersHorizontalIcon />
        </IconButton>
        {published && (
          <Button onClick={onUnpublish} size="sm" variant="outline">
            Unpublish
          </Button>
        )}
        <Button
          disabled={problem !== undefined}
          onClick={onPublish}
          size="sm"
          title={problem}
        >
          {published ? "Update" : "Publish"}
        </Button>
      </div>
    </div>
  );
}

interface LanguageProps extends PostViewProps {
  locale: string;
  language?: PostLanguage;
  /** The language tabs, shown in the bar above the text. */
  tabs: ReactNode;
  /** Whether its tab is the one showing. The others stay open, hidden, so their pictures keep uploading. */
  active: boolean;
}

/**
 * One language of the post, written in place like a doc page: its title and
 * text, a bar to publish it, and its settings beside it. The text saves as a
 * draft while typing; publishing puts the draft on the website.
 */
function LanguageEditor({
  project,
  website,
  blog,
  post,
  pubkey,
  locale,
  language,
  tabs,
  active,
}: LanguageProps) {
  const editor = useRef<PageEditorHandle>(null);
  const version = language && currentVersion(language);
  const base: PostFields = version ?? startLanguage(post, locale, pubkey);
  // The version the text opened from, kept while it's open.
  // oxlint-disable-next-line react/hook-use-state -- read once, never set
  const [opened] = useState(() => version?.event ?? blankVersion(pubkey));
  // Changes not saved yet: typed into a field, or about to be saved.
  const [edits, setEdits] = useState<Partial<PostFields>>({});
  const pending = useRef<Partial<PostFields>>({});
  const [preview, setPreview] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const waiting = useUploadsWaiting();
  const fields: PostFields = { ...base, ...edits, images: knownImages(post) };
  const status = language ? languageStatus(language) : "draft";
  const published = language?.published;
  const schema = useMemo(() => articleSchema({ website }), [website]);

  /** Something besides the text changed: keep it for the next save. */
  const change = (next: Partial<PostFields>) => {
    pending.current = { ...pending.current, ...next };
    setEdits(pending.current);
    editor.current?.changed();
  };

  /** Saves now; the saved version shows from then on. */
  const settle = () => {
    editor.current?.save();
    pending.current = {};
    setEdits({});
  };

  const onPublish = (content: string, prev: NostrEvent) => {
    // A post someone deleted stays deleted, even with edits left to save.
    if (isDiscarded(project, post.id, locale)) {
      return Promise.resolve(false);
    }
    return saveDraft(
      project,
      { ...base, ...pending.current, content, images: knownImages(post) },
      language,
      prev
    );
  };

  const onTitle = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const title = event.target.value.replaceAll("\n", " ");
    change({
      slug: followTitle(
        fields.slug,
        fields.title,
        title,
        wasPublished(fields, language)
      ),
      title,
    });
  };

  const onTitleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const field = event.currentTarget;
    const atEnd = field.selectionStart === field.value.length;
    if (
      (event.key === "Enter" && !event.nativeEvent.isComposing) ||
      (event.key === "ArrowDown" && atEnd)
    ) {
      event.preventDefault();
      editor.current?.focus("start");
    }
  };

  // Shared changes, from this tab or another, save with what's typed here.
  const saveShared = useEffectEvent((shared: Partial<SharedFields>) => {
    // As in the other languages: a new cover's alt text starts empty.
    const { coverAlt } = withShared(fields, shared);
    change({ ...shared, coverAlt });
    settle();
  });
  useEffect(
    () => openLanguage(post.id, locale, (shared) => saveShared(shared)),
    [post.id, locale]
  );

  // Every language written takes them, as the store has it when they're
  // saved: a cover can finish uploading after the tab or the post changed.
  const onShared = (shared: Partial<SharedFields>, cover?: ImageMeta) =>
    updateShared(project, website, post.id, shared, cover);

  const onDate = (publishedAt?: number) => {
    change({ publishedAt });
    settle();
  };

  const problem =
    publishProblem(blog, fields) ??
    (waiting > 0 ? "Wait for the pictures to finish uploading." : undefined);
  // Published as it stands, with nothing typed since.
  const upToDate = status === "published" && Object.keys(edits).length === 0;

  const publishNow = async () => {
    const publishedAt =
      fields.publishedAt ?? published?.publishedAt ?? unixNow();
    // The draft keeps the date, so publishing again later keeps it too.
    change({ publishedAt });
    const ready: PostFields = {
      ...base,
      ...pending.current,
      content: editor.current?.read() ?? base.content,
      images: knownImages(post),
    };
    settle();
    if (await publishLanguage(project, ready, language)) {
      toast.success(
        `${published ? "Updated" : "Published"} on ${website.name}`,
        {
          action: {
            label: "View",
            onClick: () =>
              window.open(
                postUrl(website, locale, ready.slug),
                "_blank",
                "noopener"
              ),
          },
        }
      );
    }
  };

  const unpublish = async () => {
    if (language && (await unpublishLanguage(project, post, language))) {
      toast.success(`Taken off ${website.name}`);
    }
  };

  const settings = (
    <PostSettings
      blog={blog}
      editable
      fields={fields}
      onDate={onDate}
      onShared={onShared}
      onType={(typed: Partial<TypedFields>) => change(typed)}
      onTyped={settle}
      project={project}
      website={website}
    />
  );

  return (
    <div className={cn("flex grow flex-col", !active && "hidden")}>
      <PublishBar
        language={language}
        locale={locale}
        onPreview={() =>
          setPreview(
            preview === undefined
              ? (editor.current?.read() ?? fields.content)
              : undefined
          )
        }
        onPublish={publishNow}
        onSettings={() => setSettingsOpen(true)}
        onUnpublish={unpublish}
        previewing={preview !== undefined}
        problem={problem ?? (upToDate ? "Nothing new to publish." : undefined)}
        tabs={tabs}
        website={website}
      />
      <div className="flex grow">
        <div className="flex min-w-0 grow flex-col">
          {preview !== undefined && (
            <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-10 sm:px-16 sm:pt-10">
              <PostPreview fields={{ ...fields, content: preview }} />
            </div>
          )}
          {/* Hidden, not closed, while previewing: closing would stop pictures uploading. */}
          <article
            className={cn(
              "mx-auto flex w-full max-w-3xl grow flex-col px-4 pt-6 pb-10 sm:px-16 sm:pt-10",
              preview !== undefined && "hidden"
            )}
            lang={locale}
          >
            {!language && (
              <p className="text-muted-foreground bg-muted/60 mb-6 rounded-xl px-4 py-3 text-sm">
                Not written in {languageName(locale)} yet. Start typing to add
                it; it stays a draft until you publish it.
              </p>
            )}
            <textarea
              aria-label="Title"
              className={cn(
                TITLE,
                "placeholder:text-muted-foreground/60 field-sizing-content w-full resize-none bg-transparent outline-none"
              )}
              onBlur={() => {
                if (edits.title !== undefined) {
                  settle();
                }
              }}
              onChange={onTitle}
              onKeyDown={onTitleKeyDown}
              placeholder="Untitled"
              rows={1}
              value={fields.title}
            />
            <div className="mt-4">
              <PageEditor
                key={`${post.id}-${locale}`}
                label="Text"
                onPublish={onPublish}
                opened={opened}
                pubkey={pubkey}
                ref={editor}
                schema={schema}
                versions={language?.drafts ?? []}
              />
            </div>
            {/* Clicking under the text carries on writing at its end. */}
            <div
              aria-hidden
              className="min-h-24 grow cursor-text"
              onClick={() => editor.current?.focus("end")}
            />
          </article>
        </div>
        <aside
          aria-label="Post settings"
          className="border-border/60 sticky top-28 hidden max-h-[calc(100svh-7rem)] w-80 shrink-0 self-start overflow-y-auto border-l px-5 py-6 lg:block"
        >
          {settings}
        </aside>
      </div>
      <Sheet onOpenChange={setSettingsOpen} open={settingsOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Post settings</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">{settings}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * While pictures are still uploading, links out of the post ask first:
 * leaving closes its editors, which stops them. So does closing the tab.
 */
function UploadGuard() {
  const [, navigate] = useLocation();
  const waiting = useUploadsWaiting();
  // Where a link was going when it was held back.
  const [leaving, setLeaving] = useState<string>();

  useEffect(() => {
    if (waiting === 0) {
      return;
    }
    const keep = (event: BeforeUnloadEvent) => event.preventDefault();
    const hold = (event: MouseEvent) => {
      const link =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      const path = link ? appPath(link.getAttribute("href") ?? "") : undefined;
      const plain =
        event.button === 0 &&
        !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
      if (
        !(link && path && plain) ||
        link.getAttribute("target") === "_blank" ||
        path === `${location.pathname}${location.search}`
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setLeaving(path);
    };
    addEventListener("beforeunload", keep);
    // Before the app's own handling of the link.
    document.addEventListener("click", hold, true);
    return () => {
      removeEventListener("beforeunload", keep);
      document.removeEventListener("click", hold, true);
    };
  }, [waiting]);

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          setLeaving(undefined);
        }
      }}
      open={leaving !== undefined}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Pictures are still uploading</AlertDialogTitle>
          <AlertDialogDescription>
            Leaving the post now stops them, and they won’t be in it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (leaving) {
                navigate(leaving);
              }
            }}
            variant="destructive"
          >
            Leave anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * A language of the post as its newest version reads, for viewers of the
 * project: they can read drafts and published posts, but not change them.
 */
function ReadOnlyLanguage({
  website,
  language,
  locale,
  tabs,
}: {
  website: WebsiteConfig;
  language?: PostLanguage;
  locale: string;
  tabs: ReactNode;
}) {
  const version = language && currentVersion(language);
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        {tabs}
        <StatusLine language={language} />
        {language?.published && (
          <a
            className="text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1.5 text-sm transition-colors"
            href={postUrl(website, locale, language.published.slug)}
            rel="noopener noreferrer"
            target="_blank"
          >
            <SquareArrowOutUpRightIcon className="size-4" />
            View on site
          </a>
        )}
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-10 sm:px-16 sm:pt-10">
        {version ? (
          <PostPreview fields={version} />
        ) : (
          <p className="text-muted-foreground text-sm">
            Not written in {languageName(locale)} yet.
          </p>
        )}
      </div>
    </>
  );
}

/** A blog post: a tab per language the website publishes, each written and published on its own. */
export function PostView(props: PostViewProps) {
  const { project, website, post, pubkey } = props;
  const editable = canEdit(project, pubkey);
  const [locale, setLocale] = useState(
    () =>
      website.locales.find((each) =>
        post.languages.some((language) => language.locale === each)
      ) ??
      website.locales[0] ??
      ""
  );
  const language = post.languages.find((each) => each.locale === locale);

  const tabs = (
    <Tabs onValueChange={(value: string) => setLocale(value)} value={locale}>
      <TabsList aria-label="Languages">
        {website.locales.map((each) => {
          const written = post.languages.find((item) => item.locale === each);
          const status = written ? languageStatus(written) : undefined;
          return (
            <TabsTrigger
              key={each}
              title={`${languageName(each)}: ${status ? STATUS_LABELS[status] : "not written yet"}`}
              value={each}
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  status
                    ? STATUS_DOTS[status]
                    : "ring-muted-foreground/50 ring-1"
                )}
              />
              {languageName(each)}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );

  return (
    <>
      <TopBar crumbs={crumbsFor(project, post)}>
        <PostMenu editable={editable} post={post} project={project} />
      </TopBar>
      <main className="flex grow flex-col">
        {editable ? (
          <>
            {/* Every language stays open, so switching tabs never stops a picture uploading. */}
            {website.locales.map((each) => (
              <LanguageEditor
                {...props}
                active={each === locale}
                key={each}
                language={post.languages.find((item) => item.locale === each)}
                locale={each}
                tabs={tabs}
              />
            ))}
            <UploadGuard />
          </>
        ) : (
          <ReadOnlyLanguage
            language={language}
            locale={locale}
            tabs={tabs}
            website={website}
          />
        )}
      </main>
    </>
  );
}
