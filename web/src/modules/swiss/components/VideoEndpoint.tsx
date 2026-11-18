import { useCopy } from "@modelsphere/ui";
import type { ReleaseStatus as Status } from "@swiss/lib/api";
import { API_MODEL, API_PATHS } from "@swiss/lib/videoChart";
import { Code } from "@swiss/components/ui/code";

const KEY = "$SWISS_API_KEY";
const TASK = "$TASK_ID";

export interface VideoExample {
  title: string;
  note: string;
  curl: string;
}

// videoExamples is the job API a video release serves, against its route's URL:
// submit a task, poll it, then download what it made. The download is public on
// the route, since its URL is handed to players that send no key.
export function videoExamples(s: Pick<Status, "url" | "authHeader" | "authPrefix">): VideoExample[] {
  const url = s.url ?? "";
  const auth = `-H "${s.authHeader || "Authorization"}: ${s.authPrefix ?? "Bearer "}${KEY}"`;
  return [
    {
      title: "1. Submit a generation task",
      note: "returns {\"task_id\": \"...\"}; export it as TASK_ID",
      curl: [
        `curl -X POST ${url}${API_PATHS.submit} \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  ${auth} \\`,
        `  -d '{`,
        `    "model": "${API_MODEL}",`,
        `    "content": [{"type": "text", "text": "An otter walks slowly along a river bank"}],`,
        `    "resolution": "768P",`,
        `    "duration": 6,`,
        `    "ratio": "16:9"`,
        `  }'`,
      ].join("\n"),
    },
    {
      title: "2. Poll its status",
      note: "queued, running, then succeeded, failed or cancelled; on success task.content.url is the download",
      curl: [`curl ${url}${API_PATHS.query(TASK)} \\`, `  ${auth}`].join("\n"),
    },
    {
      title: "3. Download the video",
      note: "no key needed; supports HTTP Range",
      curl: `curl -L ${url}${API_PATHS.content(TASK)} -o output.mp4`,
    },
  ];
}

export function VideoExamples({ status }: { status: Status }) {
  return (
    <div className="space-y-3">
      {videoExamples(status).map((e) => (
        <div key={e.title}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{e.title}</span> — {e.note}
            </span>
            <CopyButton value={e.curl} />
          </div>
          <Code lang="sh">{e.curl}</Code>
        </div>
      ))}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const { copy, copied, failed } = useCopy();
  return (
    <button
      type="button"
      onClick={() => void copy(value)}
      className={`shrink-0 text-xs underline ${failed ? "text-destructive" : "text-muted-foreground hover:text-foreground"}`}
    >
      {copied ? "copied" : failed ? "copy failed" : "copy"}
    </button>
  );
}
