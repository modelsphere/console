import {
  Dialog as RiseDialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@riseaicloud/ui";

// The apply pipeline's modal. Rise's DialogContent is a max-w-lg grid with its
// own close button and p-6; this holds a diff thousands of lines long, so it is
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
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  // Pinned below the scrolling body: the action lives here, so it stays on
  // screen no matter how long the diff is. A button that scrolls away is a
  // button nobody trusts they have found.
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <RiseDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-0 border-b p-4 text-left">
          <DialogTitle className="pr-6">{title}</DialogTitle>
          {/* asChild: a subtitle carries badges and spans, which cannot nest in
              the <p> the description renders by default. */}
          {subtitle ? (
            <DialogDescription asChild>
              <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">{children}</div>

        {footer ? <div className="border-t p-4">{footer}</div> : null}
      </DialogContent>
    </RiseDialog>
  );
}
