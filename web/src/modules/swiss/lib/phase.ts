// Helm lists a release as uninstalling after the release record is gone, until
// its pods are. An LLMService uses the same phase while it has a deletionTimestamp.
// Helm's own status string is the same word.
export function isUninstalling(s: {
  phase?: string;
  status?: string;
  helmStatus?: string;
  planStatus?: { phase?: string };
  llmservice?: { phase?: string };
}): boolean {
  return (
    s.phase === "uninstalling" ||
    s.status === "uninstalling" ||
    s.helmStatus === "uninstalling" ||
    s.planStatus?.phase === "uninstalling" ||
    s.llmservice?.phase === "uninstalling"
  );
}

export type Phase = "applying" | "applied" | "failed" | "uninstalling";

// A list row's phase is swiss's own word for a helm release ("applied") and the
// operator's for an LLMService ("Applied", "Pending"). This reads either in
// swiss's words, as the server already does for planStatus.
export function rowPhase(phase?: string): Phase | undefined {
  switch (phase?.toLowerCase()) {
    case "pending":
    case "applying":
      return "applying";
    case "applied":
      return "applied";
    case "failed":
      return "failed";
    case "deleting":
    case "uninstalling":
      return "uninstalling";
  }
  return undefined;
}
