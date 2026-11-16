package pluginpackage

import (
	"archive/tar"
	"compress/gzip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInspectDirectory(t *testing.T) {
	directory := writeChartDirectory(t)
	artifact, err := Inspect(directory)
	if err != nil {
		t.Fatalf("Inspect() error = %v", err)
	}
	if !artifact.Directory || artifact.Chart.Name != "canaryd" || artifact.Manifest.Name != "canary" {
		t.Fatalf("unexpected artifact: %+v", artifact)
	}
}

func TestInspectHelmArchiveWithTopLevelDirectory(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "canaryd-0.3.0.tgz")
	createArchive(t, archivePath, map[string]string{
		"canaryd/Chart.yaml":    "apiVersion: v2\nname: canaryd\nversion: 0.3.0\ntype: application\n",
		"canaryd/plugin.yaml":   pluginYAML(),
		"canaryd/templates/app": "kind: Deployment\n",
	})
	artifact, err := Inspect(archivePath)
	if err != nil {
		t.Fatalf("Inspect() error = %v", err)
	}
	if artifact.Directory || artifact.Chart.Name != "canaryd" {
		t.Fatalf("unexpected archive artifact: %+v", artifact)
	}
}

func TestInspectReadsV1CapabilityBindings(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "Chart.yaml"), []byte("apiVersion: v2\nname: canaryd\nversion: 0.3.0\ntype: application\n"), 0600); err != nil {
		t.Fatal(err)
	}
	manifest := "apiVersion: v1\ngroup: modelsphere.dev\nname: canary\nversion: 0.4.0\ndisplayName: Canary\ndescription: Persistent model inference experiments.\nconsumes:\n  - capability: platform.modelsphere.dev/image-pull-secrets\n    version: v1\n  - capability: swiss.modelsphere.dev/gateway\n    version: v1\n    from:\n      kind: Plugin\n      name: swiss\n      version: \">=0.4.0 <0.6.0\"\nfrontend:\n  type: component\n  runtime: remote\n  entry: index.umd.js\nactivation:\n  policy: auto\n"
	if err := os.WriteFile(filepath.Join(directory, "plugin.yaml"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
	artifact, err := Inspect(directory)
	if err != nil {
		t.Fatalf("Inspect() error = %v", err)
	}
	bindings := artifact.Manifest.Consumes
	if len(bindings) != 2 || bindings[0].Capability != "platform.modelsphere.dev/image-pull-secrets" {
		t.Fatalf("Consumes = %+v", bindings)
	}
	if bindings[1].From == nil || bindings[1].From.Kind != "Plugin" || bindings[1].From.Version != ">=0.4.0 <0.6.0" {
		t.Fatalf("binding source = %+v", bindings[1].From)
	}
}

func TestInspectRejectsUnsafeArchivePath(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "unsafe.tgz")
	createArchive(t, archivePath, map[string]string{
		"canaryd/Chart.yaml":    "apiVersion: v2\nname: canaryd\nversion: 0.3.0\ntype: application\n",
		"canaryd/plugin.yaml":   pluginYAML(),
		"canaryd/../escape.txt": "unsafe",
	})
	_, err := Inspect(archivePath)
	if err == nil || !strings.Contains(err.Error(), "unsafe path") {
		t.Fatalf("Inspect() error = %v, want unsafe path error", err)
	}
}

func writeChartDirectory(t *testing.T) string {
	t.Helper()
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "Chart.yaml"), []byte("apiVersion: v2\nname: canaryd\nversion: 0.3.0\ntype: application\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "plugin.yaml"), []byte(pluginYAML()), 0600); err != nil {
		t.Fatal(err)
	}
	return directory
}

func pluginYAML() string {
	return "apiVersion: v1\ngroup: modelsphere.dev\nname: canary\nversion: 0.4.0\ndisplayName: Canary\nconsumes:\n  - capability: swiss.modelsphere.dev/gateway\n    version: v1\n  - capability: platform.modelsphere.dev/inference-namespaces\nfrontend:\n  type: component\n  runtime: remote\n  entry: index.umd.js\n"
}

func createArchive(t *testing.T, destination string, files map[string]string) {
	t.Helper()
	file, err := os.Create(destination)
	if err != nil {
		t.Fatal(err)
	}
	gzipWriter := gzip.NewWriter(file)
	tarWriter := tar.NewWriter(gzipWriter)
	for name, content := range files {
		data := []byte(content)
		header := &tar.Header{Name: name, Mode: 0600, Size: int64(len(data))}
		if err := tarWriter.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if _, err := tarWriter.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}
