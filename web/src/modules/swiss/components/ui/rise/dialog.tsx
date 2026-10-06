import { cn } from "@swiss/lib/utils";
import {
  Dialog as KitDialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@modelsphere/ui";

// The apply pipeline's modal. The kit's DialogContent is a small padded grid
// (sm:max-w-sm, p-4); this holds a diff thousands of lines long, so it is
// re-laid-out as a column: fixed header, scrolling body, pinned footer.
//
// Dismissing is not the same as cancelling. Closing this leaves the composed
// plan and the diff exactly where they were -- reopening returns to them --
// because the only irreversible thing in here is the apply button.
export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  footer,
  size = "lg",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  // sm for a confirmation, md for a form; lg (the default) holds a diff.
  size?: "sm" | "md" | "lg";
  // Pinned below the scrolling body: the action lives here, so it stays on
  // screen no matter how long the diff is. A button that scrolls away is a
  // button nobody trusts they have found.
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <KitDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className={cn(
          "flex max-h-[calc(100vh-2rem)] w-full flex-col gap-0 overflow-hidden p-0",
          // sm: as well, or the kit's sm:max-w-sm wins from the sm breakpoint up.
          size === "sm" ? "max-w-md sm:max-w-md" : size === "md" ? "max-w-2xl sm:max-w-2xl" : "max-w-5xl sm:max-w-5xl",
        )}
      >
        <DialogHeader className="gap-0 border-b p-4 text-left">
          <DialogTitle className="pr-6">{title}</DialogTitle>
          {/* render a <div>: a subtitle carries badges and spans, which cannot
              nest in the <p> the description renders by default. */}
          {subtitle ? (
            <DialogDescription render={<div className="mt-1 text-sm text-muted-foreground" />}>
              {subtitle}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">{children}</div>

        {footer ? <div className="border-t p-4">{footer}</div> : null}
      </DialogContent>
    </KitDialog>
  );
}
