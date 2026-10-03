import type { ReactNode } from "react";
import { Card, CardAction, CardContent, CardHeader, CardTitle, cn } from "@modelsphere/ui";

// A titled card: the title and its hint on a header row with a rule under it,
// actions on the right. Every block on the detail page is one of these.
export function Section({
  title,
  hint,
  action,
  className,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardHeader className="border-b py-3">
        <CardTitle className="flex items-baseline gap-2 text-sm">
          {title}
          {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
        </CardTitle>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="py-4">{children}</CardContent>
    </Card>
  );
}

// One label/value row of a key-value list. An empty value leaves the row out:
// the list is read at a glance, and empty rows bury the ones that were set.
export function Field({ label, children }: { label: ReactNode; children?: ReactNode }) {
  if (children === undefined || children === null || children === "") return null;
  return (
    <div className="grid grid-cols-[7rem_1fr] items-baseline gap-3 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
