import type { ReactNode, Ref } from "react";

interface BucketProps {
  title: string;
  count: number;
  actions?: ReactNode;
  children: ReactNode;
  ref?: Ref<HTMLElement>;
}

export function Bucket({ title, count, actions, children, ref }: BucketProps) {
  return (
    <section
      className="bg-muted/60 flex flex-col gap-1 rounded-2xl p-1.5"
      ref={ref}
    >
      <div className="flex h-9 items-center gap-2 pl-2">
        <h2 className="min-w-0 truncate text-sm font-medium">{title}</h2>
        <span className="text-muted-foreground text-sm tabular-nums">
          {count}
        </span>
        {actions && (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {actions}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}
