package plugincli

import (
	"bufio"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	pluginapi "github.com/modelsphere/console/api/plugin/v1alpha1"
	sigyaml "sigs.k8s.io/yaml"
)

func TestForcePackagePreservesOldPackageWhenGeneratedArchiveIsInvalid(t *testing.T) {
	directory := t.TempDir()
	chart := filepath.Join(directory, "chart")
	if err := os.Mkdir(chart, 0700); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"Chart.yaml": "apiVersion: v2\nname: example\nversion: 1.0.0\n",
		"plugin.yaml": `apiVersion: v1
group: modelsphere.dev
name: example
version: 1.0.0
frontend:
  type: component
  runtime: remote
  entry: index.umd.js
`,
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(chart, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	helm := filepath.Join(directory, "helm")
	if err := os.WriteFile(helm, []byte("#!/bin/sh\nif [ \"$1\" = package ]; then printf invalid > \"$4/example-1.0.0.tgz\"; fi\n"), 0700); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(directory, "example-1.0.0.tgz")
	if err := os.WriteFile(output, []byte("previous package"), 0600); err != nil {
		t.Fatal(err)
	}
	command := packageCommand(&Options{HelmPath: helm, Timeout: 10 * time.Second})
	command.SetArgs([]string{chart, "--destination", directory, "--force"})
	if err := command.Execute(); err == nil || !strings.Contains(err.Error(), "validate generated package") {
		t.Fatalf("Execute() error = %v", err)
	}
	content, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "previous package" {
		t.Fatal("failed rebuild replaced the previous package")
	}
}

func TestConsumedValuesFollowProviderDeclarations(t *testing.T) {
	values := consoleValues{ImagePullSecrets: []imagePullSecret{{Name: "registry-pull"}}}
	providers := []capabilityProvider{platformCapabilityProvider(values, "console-system")}
	consumed, err := resolveCapabilities([]pluginapi.PluginCapabilityBinding{
		{Capability: capabilityImagePullSecrets, Version: "v1"},
	}, providers, "console-system")
	if err != nil {
		t.Fatalf("resolveCapabilities() error = %v", err)
	}
	path, err := writeConsumedValues(consumed)
	if err != nil {
		t.Fatalf("writeConsumedValues() error = %v", err)
	}
	defer os.Remove(path)
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"consumed:", "modelsphere.dev/platform:", "imagePullSecrets:", "name: registry-pull"} {
		if !strings.Contains(string(content), expected) {
			t.Fatalf("consumed values missing %q: %s", expected, content)
		}
	}
	if path, err := writeConsumedValues(nil); err != nil || path != "" {
		t.Fatalf("empty bindings received an overlay: %q, %v", path, err)
	}
}

func TestChoosePluginUsesStableIdentity(t *testing.T) {
	choices := []pluginChoice{
		{Group: "modelsphere.dev", Name: "canary", Version: "0.4.0", Release: "canary"},
		{Group: "modelsphere.dev", Name: "metrics", Version: "1.2.1", Release: "metrics"},
	}
	var output bytes.Buffer
	selected, err := choosePlugin(bufio.NewReader(strings.NewReader("2\n")), &output, choices)
	if err != nil {
		t.Fatalf("choosePlugin() error = %v", err)
	}
	if got := selected.identity(); got != "modelsphere.dev/metrics" {
		t.Fatalf("selected identity = %q", got)
	}
	if !strings.Contains(output.String(), "modelsphere.dev/canary") {
		t.Fatalf("selection output did not show stable identity: %s", output.String())
	}
}

func TestSelectPluginAcceptsBareName(t *testing.T) {
	choices := []pluginChoice{{Group: "modelsphere.dev", Name: "canary"}}
	selected, err := selectPlugin(choices, "canary")
	if err != nil {
		t.Fatalf("selectPlugin() error = %v", err)
	}
	if got := selected.identity(); got != "modelsphere.dev/canary" {
		t.Fatalf("bare-name identity = %q", got)
	}
}

func TestConfirmUninstallRequiresExplicitYes(t *testing.T) {
	var output bytes.Buffer
	if err := confirmUninstall(bufio.NewReader(strings.NewReader("n\n")), &output, "modelsphere.dev/canary"); err == nil {
		t.Fatal("confirmUninstall() accepted a negative answer")
	}
	if err := confirmUninstall(bufio.NewReader(strings.NewReader("yes\n")), &output, "modelsphere.dev/canary"); err != nil {
		t.Fatalf("confirmUninstall() error = %v", err)
	}
}

func TestSelectionAndConfirmationShareInput(t *testing.T) {
	choices := []pluginChoice{{Group: "modelsphere.dev", Name: "canary"}}
	reader := bufio.NewReader(strings.NewReader("1\ny\n"))
	var output bytes.Buffer
	selected, err := selectUninstallPlugin(reader, &output, choices, "")
	if err != nil {
		t.Fatalf("selectUninstallPlugin() error = %v", err)
	}
	if err := confirmUninstall(reader, &output, selected.identity()); err != nil {
		t.Fatalf("confirmUninstall() error = %v", err)
	}
}

func TestResolveCapabilitiesEnforcesNamespaceScope(t *testing.T) {
	providers := []capabilityProvider{platformCapabilityProvider(consoleValues{}, "console-system")}
	bindings := []pluginapi.PluginCapabilityBinding{{Capability: capabilityImagePullSecrets}}
	if _, err := resolveCapabilities(bindings, providers, "other"); err == nil || !strings.Contains(err.Error(), "namespace-scoped") {
		t.Fatalf("cross-namespace binding error = %v", err)
	}
	if _, err := resolveCapabilities(bindings, providers, "console-system"); err != nil {
		t.Fatalf("same-namespace binding error = %v", err)
	}
}

func TestResolveCapabilitiesRejectsUnpublishedValues(t *testing.T) {
	providers := []capabilityProvider{platformCapabilityProvider(consoleValues{}, "console-system")}
	_, err := resolveCapabilities([]pluginapi.PluginCapabilityBinding{{Capability: capabilityInferenceNamespaces}}, providers, "console-system")
	if err == nil || !strings.Contains(err.Error(), "inferenceNamespaces") {
		t.Fatalf("resolveCapabilities() error = %v", err)
	}
}

func TestRegistrationCommandPrintsPluginCR(t *testing.T) {
	directory := t.TempDir()
	chart := filepath.Join(directory, "chart")
	if err := os.Mkdir(chart, 0700); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"Chart.yaml": "apiVersion: v2\nname: example\nversion: 1.0.0\n",
		"plugin.yaml": `apiVersion: v1
group: modelsphere.dev
name: example
version: 1.2.0
frontend:
  type: component
  runtime: remote
  entry: index.js
`,
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(chart, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	command := registrationCommand(&Options{ConfigPath: filepath.Join(directory, "config.yaml"), Timeout: time.Second})
	var output bytes.Buffer
	command.SetOut(&output)
	command.SetArgs([]string{chart, "--console-release", "modelsphere-console", "--console-namespace", "console-system"})
	if err := command.Execute(); err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	var registered pluginapi.Plugin
	if err := sigyaml.Unmarshal(output.Bytes(), &registered); err != nil {
		t.Fatalf("decode registration: %v", err)
	}
	if registered.APIVersion != "modelsphere.dev/v1alpha1" || registered.Kind != "Plugin" {
		t.Fatalf("registration type = %s %s", registered.APIVersion, registered.Kind)
	}
	if registered.Name != "modelsphere.dev--example" {
		t.Fatalf("registration name = %q", registered.Name)
	}
	spec := registered.Spec
	if !spec.Enabled || spec.Type != pluginapi.PluginTypeHelm || spec.Scope != "platform" || spec.Version != "1.0.0" {
		t.Fatalf("registration spec = %+v", spec)
	}
	if spec.Chart.Name != "example" || spec.Chart.Namespace != "console-system" || spec.Chart.ReleaseName != "example" {
		t.Fatalf("registration chart = %+v", spec.Chart)
	}
}

func TestSwissCapabilityProviderPublishesGatewayBinding(t *testing.T) {
	console := consoleValues{
		ExternalSwiss: externalSwissValues{
			URL:      "http://swissd.swiss-system.svc:80/api",
			ProxyKey: externalSwissProxyKey{SecretName: "swiss-proxy-key"},
		},
		Platform: platformValues{InferenceNamespaces: []string{"swiss-deploy"}},
	}
	provider, err := swissCapabilityProvider(console)
	if err != nil {
		t.Fatalf("swissCapabilityProvider() error = %v", err)
	}
	consumed, err := resolveCapabilities([]pluginapi.PluginCapabilityBinding{
		{Capability: capabilitySwissGateway, Version: "v1"},
		{Capability: capabilityInferenceNamespaces},
	}, []capabilityProvider{platformCapabilityProvider(console, "console-system"), provider}, "console-system")
	if err != nil {
		t.Fatalf("resolveCapabilities() error = %v", err)
	}
	path, err := writeConsumedValues(consumed)
	if err != nil {
		t.Fatalf("writeConsumedValues() error = %v", err)
	}
	defer os.Remove(path)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read consumed values: %v", err)
	}
	content := string(data)
	for _, expected := range []string{"modelsphere.dev/swiss:", "endpoint: http://swissd.swiss-system.svc:80", "apiKeyRef: swiss-proxy-key", "apiKeyKey: proxyKey", "inferenceNamespaces:", "- swiss-deploy"} {
		if !strings.Contains(content, expected) {
			t.Fatalf("consumed values missing %q: %s", expected, content)
		}
	}
}

func TestSwissCapabilityProviderRejectsMissingConsoleConfiguration(t *testing.T) {
	_, err := swissCapabilityProvider(consoleValues{})
	if err == nil || !strings.Contains(err.Error(), "externalSwiss.url") {
		t.Fatalf("swissCapabilityProvider() error = %v", err)
	}
}
