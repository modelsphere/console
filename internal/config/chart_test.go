package config

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// helm refuses to render the chart before its dependencies are fetched, even
// with swiss.enabled off. CI fetches them; locally that is one command.
func requireChartDependencies(t *testing.T, root string) {
	t.Helper()
	if m, _ := filepath.Glob(filepath.Join(root, "helm", "console", "charts", "swiss-*.tgz")); len(m) == 0 {
		t.Skip("chart dependencies not fetched: helm dependency build helm/console")
	}
}

// renderChartConfig templates the chart's ConfigMap and loads the console.yaml
// out of it, so the chart and the loader are checked against each other rather
// than against a copy of what the chart is believed to emit.
func renderChartConfig(t *testing.T, args ...string) *Config {
	t.Helper()
	if _, err := exec.LookPath("helm"); err != nil {
		t.Skip("helm is not installed")
	}

	root := filepath.Join("..", "..")
	requireChartDependencies(t, root)
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

// With no gateway, the demo model is the llm backend itself: console reaches
// llama.cpp by URL, and /v1 goes there too.
func TestHelmDemoIsTheLLMBackend(t *testing.T) {
	c := renderChartConfig(t, "--set", "demo.enabled=true")
	c.Server.Auth.JWTSecret = "test"
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
	var llm *Backend
	for i := range c.Backends {
		if c.Backends[i].Name == "llm" {
			llm = &c.Backends[i]
		}
	}
	if llm == nil || llm.Gateway != nil || llm.URL != "http://console-console-demo.modelsphere.svc:8080" {
		t.Fatalf("llm backend = %+v, want the demo Service by URL", llm)
	}
	if c.Router.Backend != "llm" || c.Router.Secret == "" {
		t.Fatalf("router = %+v, want it on the demo model", c.Router)
	}
}

func TestHelmDemoWithAGatewayIsRefused(t *testing.T) {
	if _, err := exec.LookPath("helm"); err != nil {
		t.Skip("helm is not installed")
	}
	requireChartDependencies(t, filepath.Join("..", ".."))
	out, err := exec.Command("helm", "template", "console", filepath.Join("..", "..", "helm", "console"),
		"--set", "demo.enabled=true", "--set", "playground.gateway.profile=swiss/site-profile").CombinedOutput()
	if err == nil || !bytes.Contains(out, []byte("demo.enabled and playground.gateway")) {
		t.Fatalf("want a refusal naming both values, got err=%v\n%s", err, out)
	}
}

// The swiss subchart: console proxies to its Service with swissd's front-proxy
// key and reads its site profile, and swissd keeps its own login on.
func TestHelmSwissSubchartIsWiredIn(t *testing.T) {
	on := []string{"--set", "swiss.enabled=true", "--set", "swiss.rbac.namespaces={models}"}
	c := renderChartConfig(t, on...)
	c.Server.Auth.JWTSecret = "test"
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
	byName := map[string]Backend{}
	for _, b := range c.Backends {
		byName[b.Name] = b
	}
	if b := byName["swiss"]; b.URL != "http://console-swiss.modelsphere.svc:80/api" || b.APIKeyEnv != "SWISS_PROXY_KEY" {
		t.Fatalf("swiss backend = %+v, want the subchart's Service with its proxy key", b)
	}
	if g := byName["llm"].Gateway; g == nil || g.Profile != "modelsphere/console-swiss-profile" {
		t.Fatalf("llm backend = %+v, want swissd's site profile", byName["llm"])
	}

	out, err := exec.Command("helm", append([]string{"template", "console", filepath.Join("..", "..", "helm", "console"),
		"--namespace", "modelsphere", "--show-only", "charts/swiss/templates/configmap.yaml"}, on...)...).CombinedOutput()
	if err != nil {
		t.Fatalf("helm template: %v\n%s", err, out)
	}
	if bytes.Contains(out, []byte("disabled: true")) || !bytes.Contains(out, []byte("dir: /etc/swiss-auth")) {
		t.Fatalf("swissd's login must stay on behind console:\n%s", out)
	}
}

func helmTemplate(t *testing.T, args ...string) (string, error) {
	t.Helper()
	if _, err := exec.LookPath("helm"); err != nil {
		t.Skip("helm is not installed")
	}
	root := filepath.Join("..", "..")
	requireChartDependencies(t, root)
	out, err := exec.Command("helm", append([]string{"template", "console", filepath.Join(root, "helm", "console"),
		"--namespace", "modelsphere"}, args...)...).CombinedOutput()
	return string(out), err
}

// A swissd installed elsewhere is wired the way the subchart is: its URL, its
// proxy key from a Secret in console's namespace, its site profile.
func TestHelmExternalSwissIsWiredIn(t *testing.T) {
	example := filepath.Join("..", "..", "helm", "console", "values-existing-stack.example.yaml")
	c := renderChartConfig(t, "--values", example)
	byName := map[string]Backend{}
	for _, b := range c.Backends {
		byName[b.Name] = b
	}
	if b := byName["swiss"]; b.URL != "http://swiss.swiss-system.svc:80/api" || b.APIKeyEnv != "SWISS_PROXY_KEY" {
		t.Fatalf("swiss backend = %+v, want externalSwiss.url with its proxy key", b)
	}
	if g := byName["llm"].Gateway; g == nil || g.Profile != "swiss-system/swiss-profile" {
		t.Fatalf("llm backend = %+v, want externalSwiss.profile", byName["llm"])
	}

	deploy, err := helmTemplate(t, "--values", example, "--show-only", "templates/deployment.yaml")
	if err != nil {
		t.Fatalf("helm template: %v\n%s", err, deploy)
	}
	if !strings.Contains(deploy, `name: "swiss-proxy-key"`) || !strings.Contains(deploy, `key: "proxyKey"`) {
		t.Fatalf("SWISS_PROXY_KEY is not read from externalSwiss.proxyKey:\n%s", deploy)
	}
}

func TestHelmSwissTwiceIsRefused(t *testing.T) {
	out, err := helmTemplate(t, "--set", "swiss.enabled=true", "--set", "swiss.rbac.namespaces={models}",
		"--set", "externalSwiss.url=http://swiss.swiss.svc:80/api")
	if err == nil || !strings.Contains(out, "swiss.enabled installs a swissd and externalSwiss.url names another") {
		t.Fatalf("want a refusal naming both, got err=%v\n%s", err, out)
	}
}
