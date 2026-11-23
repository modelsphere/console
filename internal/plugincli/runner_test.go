package plugincli

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
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

func TestUpgradePluginRollsBackFailedInstalls(t *testing.T) {
	directory := t.TempDir()
	recorded := filepath.Join(directory, "args.txt")
	script := filepath.Join(directory, "helm.sh")
	content := "#!/bin/sh\nprintf '%s\\n' \"$@\" > '" + recorded + "'\n"
	if err := os.WriteFile(script, []byte(content), 0755); err != nil {
		t.Fatalf("write helm fixture: %v", err)
	}
	runner := Runner{HelmPath: script, CommandTimeout: 10 * time.Second}
	if err := runner.UpgradePlugin(context.Background(), "canary", "/tmp/canaryd.tgz", "console-system", []string{"/tmp/values.yaml"}, true, 5*time.Minute); err != nil {
		t.Fatalf("UpgradePlugin() error = %v", err)
	}
	data, err := os.ReadFile(recorded)
	if err != nil {
		t.Fatalf("read recorded args: %v", err)
	}
	args := string(data)
	for _, expected := range []string{"upgrade\n", "--install\n", "--atomic\n", "--wait\n", "--timeout\n5m0s\n", "--values\n/tmp/values.yaml\n"} {
		if !strings.Contains(args, expected) {
			t.Fatalf("helm args missing %q: %s", expected, args)
		}
	}
}

// pageLister serves prepared metadata pages and records the list options it saw.
type pageLister struct {
	pages   []*metav1.PartialObjectMetadataList
	options []metav1.ListOptions
}

func (lister *pageLister) List(_ context.Context, options metav1.ListOptions) (*metav1.PartialObjectMetadataList, error) {
	lister.options = append(lister.options, options)
	if len(lister.pages) == 0 {
		return &metav1.PartialObjectMetadataList{}, nil
	}
	page := lister.pages[0]
	lister.pages = lister.pages[1:]
	return page, nil
}

// releaseMetadata builds one release Secret's metadata for a list page.
func releaseMetadata(namespace, name, status string) metav1.PartialObjectMetadata {
	return metav1.PartialObjectMetadata{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: namespace,
			Labels:    map[string]string{"owner": "helm", "name": name, "status": status},
		},
	}
}

func TestListDeployedReleasesReadsHelmSecretLabelsAcrossPages(t *testing.T) {
	first := &metav1.PartialObjectMetadataList{
		ListMeta: metav1.ListMeta{Continue: "next-page"},
		Items: []metav1.PartialObjectMetadata{
			releaseMetadata("console-system", "modelsphere-console", "deployed"),
			releaseMetadata("other", "old-release", "superseded"),
			releaseMetadata("broken", "", "deployed"),
		},
	}
	second := &metav1.PartialObjectMetadataList{
		Items: []metav1.PartialObjectMetadata{
			releaseMetadata("canary-modelsphere-system", "canary", "deployed"),
		},
	}
	lister := &pageLister{pages: []*metav1.PartialObjectMetadataList{first, second}}

	runner := Runner{CommandTimeout: 10 * time.Second, secretMetadata: lister}
	releases, err := runner.ListDeployedReleases(context.Background())
	if err != nil {
		t.Fatalf("ListDeployedReleases() error = %v", err)
	}
	if len(releases) != 2 {
		t.Fatalf("ListDeployedReleases() returned %d releases, want 2: %+v", len(releases), releases)
	}
	if releases[0].Name != "modelsphere-console" || releases[0].Namespace != "console-system" || releases[0].Status != "deployed" {
		t.Fatalf("first release = %+v", releases[0])
	}
	if releases[1].Name != "canary" || releases[1].Namespace != "canary-modelsphere-system" {
		t.Fatalf("second release = %+v", releases[1])
	}
	if len(lister.options) != 2 {
		t.Fatalf("list requests = %d, want 2", len(lister.options))
	}
	if lister.options[0].LabelSelector != helmReleaseSelector || lister.options[0].Limit != helmMetadataPageSize {
		t.Fatalf("first list options = %+v", lister.options[0])
	}
	if lister.options[1].Continue != "next-page" {
		t.Fatalf("second list continue = %q, want next-page", lister.options[1].Continue)
	}
}

func TestListDeployedReleasesReportsListFailures(t *testing.T) {
	failing := failingLister{err: errors.New("connection reset")}
	runner := Runner{CommandTimeout: 10 * time.Second, secretMetadata: failing}
	if _, err := runner.ListDeployedReleases(context.Background()); err == nil || !strings.Contains(err.Error(), "list deployed Helm releases") {
		t.Fatalf("ListDeployedReleases() error = %v, want a wrapped list failure", err)
	}
}

// failingLister always returns its error, standing in for an unreachable API server.
type failingLister struct {
	err error
}

func (lister failingLister) List(context.Context, metav1.ListOptions) (*metav1.PartialObjectMetadataList, error) {
	return nil, lister.err
}
