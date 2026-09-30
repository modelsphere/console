package config

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"gopkg.in/yaml.v3"
)

// renderChartConfig templates the chart's ConfigMap and loads the console.yaml
// out of it, so the chart and the loader are checked against each other rather
// than against a copy of what the chart is believed to emit.
func renderChartConfig(t *testing.T, args ...string) *Config {
	t.Helper()
	if _, err := exec.LookPath("helm"); err != nil {
		t.Skip("helm is not installed")
	}

	root := filepath.Join("..", "..")
	argv := append([]string{
		"template", "console", filepath.Join(root, "helm", "console"),
		"--namespace", "modelsphere",
		"--show-only", "templates/configmap.yaml",
	}, args...)
	cmd := exec.Command("helm", argv...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("helm template: %v\n%s", err, stderr.String())
	}

	var configMap struct {
		Data map[string]string `yaml:"data"`
	}
	if err := yaml.Unmarshal(out, &configMap); err != nil {
		t.Fatal(err)
	}
	document := configMap.Data["console.yaml"]
	if document == "" {
		t.Fatal("rendered ConfigMap has no console.yaml")
	}
	path := filepath.Join(t.TempDir(), "console.yaml")
	if err := os.WriteFile(path, []byte(document), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestHelmExistingStackExampleProducesValidConfig(t *testing.T) {
	root := filepath.Join("..", "..")
	c := renderChartConfig(t, "--values", filepath.Join(root, "helm", "console", "values-existing-stack.example.yaml"))
	c.Server.Auth.JWTSecret = "test"
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
}

// auth.disabled has to survive the whole path -- values, template, loader -- and
// carry the one thing that makes it useful: no signing key is needed, because
// nothing is signed.
func TestHelmAuthDisabledNeedsNoSigningKey(t *testing.T) {
	c := renderChartConfig(t, "--set", "auth.disabled=true")
	if !c.Server.Auth.Disabled {
		t.Fatal("auth.disabled=true did not reach the rendered config")
	}
	if err := c.Validate(); err != nil {
		t.Fatalf("validate without a jwtSecret: %v", err)
	}
}

func TestHelmAuthEnabledStillNeedsASigningKey(t *testing.T) {
	c := renderChartConfig(t)
	if c.Server.Auth.Disabled {
		t.Fatal("auth is disabled by default")
	}
	if err := c.Validate(); err == nil {
		t.Fatal("validate accepted an empty jwtSecret while auth is enabled")
	}
}
