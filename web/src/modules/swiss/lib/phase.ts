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
