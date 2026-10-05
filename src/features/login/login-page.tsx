import { cn } from "cn";
import { RefreshCwIcon } from "lucide-react";
import type { Variants } from "motion/react";
import { AnimatePresence, motion } from "motion/react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { CopyButton } from "@/components/copy";
import { Logo } from "@/components/logo";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { getConfig } from "@/config";
import { QrCode } from "@/features/login/qr-code";
import type { NostrConnectSession } from "@/lib/login";
import {
  createNostrConnect,
  loginWithBunker,
  loginWithExtension,
  waitForExtension,
} from "@/lib/login";
import { errorMessage } from "@/lib/utils";

const QR_LIFETIME = 180_000;
const EASE = [0.23, 1, 0.32, 1] as const;

const STAGGER: Variants = { show: { transition: { staggerChildren: 0.08 } } };
const RISE: Variants = {
  hidden: { filter: "blur(4px)", opacity: 0, y: 12 },
  show: {
    filter: "blur(0px)",
    opacity: 1,
    transition: { duration: 0.4, ease: EASE },
    y: 0,
  },
};
const SWAP = {
  animate: {
    filter: "blur(0px)",
    opacity: 1,
    transition: { duration: 0.2, ease: EASE },
  },
  exit: {
    filter: "blur(4px)",
    opacity: 0,
    transition: { duration: 0.12, ease: EASE },
  },
  initial: { filter: "blur(4px)", opacity: 0 },
};

function ErrorText({ children }: { children: string | undefined }) {
  if (!children) {
    return null;
  }
  return (
    <p className="text-destructive text-center text-sm" role="alert">
      {children}
    </p>
  );
}

interface ConnectStatus {
  state: "waiting" | "expired" | "failed";
  error?: string;
}

function useNostrConnect(session: NostrConnectSession): ConnectStatus {
  const [status, setStatus] = useState<ConnectStatus>({ state: "waiting" });

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      setStatus({ state: "expired" });
    }, QR_LIFETIME);
    const listen = async () => {
      try {
        await session.connect(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) {
          clearTimeout(timer);
          setStatus({ error: errorMessage(error), state: "failed" });
        }
      }
    };
    listen();
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [session]);

  return status;
}

function SignerQr({
  session,
  onRefresh,
}: {
  session: NostrConnectSession;
  onRefresh: () => void;
}) {
  const { state, error } = useNostrConnect(session);
  const { uri } = session;
  const live = state === "waiting";

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="shadow-surface image-outline relative rounded-2xl bg-white p-3">
        <QrCode
          className={live ? "size-56" : "size-56 opacity-15 blur-xs"}
          value={uri}
        />
        {!live && (
          <div className="absolute inset-0 grid place-items-center">
            <Button onClick={onRefresh}>
              <RefreshCwIcon />
              Refresh
            </Button>
          </div>
        )}
      </div>
      <div className="flex h-8 items-center gap-1">
        <p className="text-muted-foreground text-sm">
          {state === "expired"
            ? "QR code expired"
            : "Scan with your Nostr signer"}
        </p>
        {live && <CopyButton label="Copy connection link" value={uri} />}
      </div>
      <ErrorText>{error}</ErrorText>
      {live && (
        <a
          className={cn(
            buttonVariants({ size: "lg" }),
            "mt-3 hidden w-full pointer-coarse:inline-flex"
          )}
          href={`nostrsigner:${uri}`}
        >
          Open signer app
        </a>
      )}
    </div>
  );
}

function BunkerForm() {
  const [uri, setUri] = useState("");
  const [pending, setPending] = useState(false);
  const [errorText, setErrorText] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setErrorText(undefined);
    try {
      await loginWithBunker(uri);
    } catch (error) {
      setErrorText(errorMessage(error));
      setPending(false);
    }
  };

  return (
    <motion.form
      className="flex w-full flex-col gap-2"
      onSubmit={submit}
      {...SWAP}
    >
      <Input
        aria-invalid={errorText ? true : undefined}
        aria-label="Bunker link"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        autoFocus
        onChange={(event) => setUri(event.target.value)}
        placeholder="bunker://…"
        spellCheck={false}
        value={uri}
      />
      <Button disabled={pending || !uri.trim()} type="submit">
        {pending && <Spinner />}
        Connect
      </Button>
      <ErrorText>{errorText}</ErrorText>
    </motion.form>
  );
}

function SignerLogin({ onUseExtension }: { onUseExtension?: () => void }) {
  const [session, setSession] = useState(createNostrConnect);
  const [bunker, setBunker] = useState(false);

  return (
    <motion.div className="flex w-full flex-col items-center gap-4" {...SWAP}>
      <SignerQr
        key={session.uri}
        onRefresh={() => setSession(createNostrConnect())}
        session={session}
      />
      <div className="flex w-full flex-col gap-2">
        <AnimatePresence initial={false} mode="wait">
          {bunker ? (
            <BunkerForm key="bunker" />
          ) : (
            <motion.div className="flex flex-col" key="toggle" {...SWAP}>
              <Button onClick={() => setBunker(true)} variant="ghost">
                Use a bunker link
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
        {onUseExtension && (
          <Button onClick={onUseExtension} variant="ghost">
            Use extension instead
          </Button>
        )}
      </div>
    </motion.div>
  );
}

function ExtensionLogin({ onUseSigner }: { onUseSigner: () => void }) {
  const [pending, setPending] = useState(false);
  const [errorText, setErrorText] = useState<string>();

  const login = async () => {
    setPending(true);
    setErrorText(undefined);
    try {
      await loginWithExtension();
    } catch (error) {
      setErrorText(errorMessage(error));
      setPending(false);
    }
  };

  return (
    <motion.div className="flex w-full flex-col gap-2" {...SWAP}>
      <Button disabled={pending} onClick={login} size="lg">
        {pending && <Spinner />}
        Log in with extension
      </Button>
      <Button onClick={onUseSigner} variant="ghost">
        Use a signer app instead
      </Button>
      <ErrorText>{errorText}</ErrorText>
    </motion.div>
  );
}

export function LoginPage() {
  const [extension, setExtension] = useState(() => "nostr" in window);
  const [preferSigner, setPreferSigner] = useState(false);

  useEffect(() => {
    if (extension) {
      return;
    }
    let active = true;
    const detect = async () => {
      const found = await waitForExtension(1000);
      if (active && found) {
        setExtension(true);
      }
    };
    detect();
    return () => {
      active = false;
    };
  }, [extension]);

  return (
    <main className="flex min-h-dvh flex-col items-center px-6 pt-16 pb-10 sm:pt-[16dvh]">
      <motion.div
        animate="show"
        className="flex w-full max-w-xs flex-col items-center gap-10"
        initial="hidden"
        variants={STAGGER}
      >
        <h1 className="sr-only">Log in to {getConfig().name}</h1>
        <motion.div variants={RISE}>
          <Logo className="h-16" />
        </motion.div>
        <motion.div className="flex w-full justify-center" variants={RISE}>
          <AnimatePresence initial={false} mode="wait">
            {extension && !preferSigner ? (
              <ExtensionLogin
                key="extension"
                onUseSigner={() => setPreferSigner(true)}
              />
            ) : (
              <SignerLogin
                key="signer"
                onUseExtension={
                  extension ? () => setPreferSigner(false) : undefined
                }
              />
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </main>
  );
}
