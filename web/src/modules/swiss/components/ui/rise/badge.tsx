import { badgeVariants, cn } from "@riseaicloud/ui";

// Rise's Badge renders a <div>; these sit inline in table cells and in the
// dialog subtitle, so this takes the library's classes and keeps the span.
//
// muted/warning/success are not Rise variants. They ride on `outline` and add
// only colour -- which is never the only signal, every one of these carries
// text as well.
const tone = {
  muted: "border-transparent bg-muted text-muted-foreground",
  warning: "border-transparent bg-warning/15 text-warning",
  success: "border-transparent bg-success/15 text-success",
} as const;

type Tone = keyof typeof tone;
type Variant = NonNullable<Parameters<typeof badgeVariants>[0]>["variant"];

export function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & { variant?: Variant | Tone }) {
  const extra = tone[variant as Tone];
  return (
    <span
      className={cn(
        badgeVariants({ variant: extra ? "outline" : (variant as Variant) }),
        "whitespace-nowrap",
        extra,
        className,
      )}
      {...props}
    />
  );
}
