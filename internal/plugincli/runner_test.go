package plugincli

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRunnerVerbosityLogsCommandAndStderr(t *testing.T) {
	directory := t.TempDir()
	script := filepath.Join(directory, "command.sh")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nprintf 'diagnostic token=secret\\n' >&2\nprintf 'result'\n"), 0755); err != nil {
		t.Fatalf("write command: %v", err)
	}
	var logs bytes.Buffer
	runner := Runner{CommandTimeout: 10 * time.Second, LogWriter: &logs, Verbosity: 4}
	output, err := runner.run(context.Background(), script, nil, "--token", "secret")
	if err != nil {
		t.Fatalf("run() error = %v", err)
	}
	if string(output) != "result" {
		t.Fatalf("run() output = %q", output)
	}
	logOutput := logs.String()
	if !strings.Contains(logOutput, "starting "+script) || !strings.Contains(logOutput, "completed "+script) {
		t.Fatalf("lifecycle logs missing: %s", logOutput)
	}
	if strings.Contains(logOutput, "secret") || !strings.Contains(logOutput, "<redacted>") {
		t.Fatalf("sensitive data was not redacted: %s", logOutput)
	}
}

func TestListDeployedReleasesReadsHelmSecretLabels(t *testing.T) {
	directory := t.TempDir()
	script := filepath.Join(directory, "kubectl.sh")
	fixture := `{"items":[
  {"metadata":{"namespace":"console-system","labels":{"owner":"helm","name":"modelsphere-console","status":"deployed","version":"71"}}},
  {"metadata":{"namespace":"other","labels":{"owner":"helm","name":"old-release","status":"superseded","version":"4"}}},
  {"metadata":{"namespace":"broken","labels":{"owner":"helm","status":"deployed"}}}
]}`
	content := "#!/bin/sh\nprintf '%s' '" + strings.ReplaceAll(fixture, "'", "'\\''") + "'\n"
	if err := os.WriteFile(script, []byte(content), 0755); err != nil {
		t.Fatalf("write kubectl fixture: %v", err)
	}

	runner := Runner{KubectlPath: script, CommandTimeout: 10 * time.Second}
	releases, err := runner.ListDeployedReleases(context.Background())
	if err != nil {
		t.Fatalf("ListDeployedReleases() error = %v", err)
	}
	if len(releases) != 1 {
		t.Fatalf("ListDeployedReleases() returned %d releases, want 1", len(releases))
	}
	if releases[0].Name != "modelsphere-console" || releases[0].Namespace != "console-system" {
		t.Fatalf("first release = %+v", releases[0])
	}
}
