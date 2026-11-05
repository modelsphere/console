import type { ReactNode } from "react";
import { useTranslation } from "../lib/translation";
import { describeError } from "../lib/errors";
export function ErrorDetails({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const { details } = describeError(error, t);
  return details ? (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer">{t("errors.details")}</summary>
      <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono">
        {details}
      </pre>
    </details>
  ) : null;
}
export function ErrorNotice({
  error,
  className = "text-sm text-destructive",
  fallback,
  children,
}: {
  error: unknown;
  className?: string;
  fallback?: Parameters<typeof describeError>[2];
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div role="alert" className={className}>
      <p className="whitespace-pre-line break-words">
        {describeError(error, t, fallback).summary}
      </p>
      <ErrorDetails error={error} />
      {children}
    </div>
  );
}
