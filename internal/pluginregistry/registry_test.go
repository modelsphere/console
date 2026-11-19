package pluginregistry

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	pluginapi "github.com/modelsphere/console/api/plugin/v1alpha1"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/release"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/tools/cache"
)

func registeredPlugin() *pluginapi.Plugin {
	return &pluginapi.Plugin{TypeMeta: metav1.TypeMeta{APIVersion: pluginapi.GroupVersion.String(), Kind: "Plugin"}, ObjectMeta: metav1.ObjectMeta{Name: "modelsphere.dev--example", Generation: 1}, Spec: pluginapi.PluginSpec{Enabled: true, Type: pluginapi.PluginTypeHelm, Scope: "platform", Version: "1.0.0", Chart: pluginapi.ChartConfig{Name: "example", Namespace: "console-system", ReleaseName: "example"}}}
}

func installedRelease() *release.Release {
	return &release.Release{Name: "example", Version: 1, Info: &release.Info{Status: release.StatusDeployed}, Chart: &chart.Chart{Metadata: &chart.Metadata{Name: "example", Version: "1.0.0"}, Files: []*chart.File{
		{Name: "plugin.yaml", Data: []byte("name: example\ngroup: modelsphere.dev\napiVersion: v1\nversion: 1.2.0\nfrontend:\n  type: component\n  runtime: remote\n  entry: index.js\n")},
		{Name: "frontend/index.js", Data: []byte("registered entry")},
	}}}
}

func registryFixture(t *testing.T) (*Registry, cache.Store, *pluginapi.Plugin) {
	t.Helper()
	plugin := registeredPlugin()
	scheme := runtime.NewScheme()
	if err := pluginapi.AddToScheme(scheme); err != nil {
		t.Fatal(err)
	}
	client := fake.NewSimpleDynamicClient(scheme, plugin)
	registry := New(client, func(context.Context, string, string) (*release.Release, error) { return installedRelease(), nil }, slog.New(slog.DiscardHandler))
	store := cache.NewStore(cache.MetaNamespaceKeyFunc)
	updateStore(t, store, plugin)
	return registry, store, plugin
}

func updateStore(t *testing.T, store cache.Store, plugin *pluginapi.Plugin) {
	t.Helper()
	raw, err := runtime.DefaultUnstructuredConverter.ToUnstructured(plugin)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Update(&unstructured.Unstructured{Object: raw}); err != nil {
		t.Fatal(err)
	}
}

func TestRegistrationDisableDeleteAndRestart(t *testing.T) {
	registry, store, plugin := registryFixture(t)
	ctx := t.Context()
	if err := registry.reconcile(ctx, plugin.Name, store); err != nil {
		t.Fatal(err)
	}
	entries := registry.Entries()
	if len(entries) != 1 || string(entries[0].Files["index.js"]) != "registered entry" {
		t.Fatal("registration not published")
	}
	if entries[0].Plugin.Status.ReleaseVersion != 1 {
		t.Fatal("actual release revision was lost")
	}
	plugin.Spec.Enabled = false
	updateStore(t, store, plugin)
	if err := registry.reconcile(ctx, plugin.Name, store); err != nil {
		t.Fatal(err)
	}
	if len(registry.Entries()) != 0 {
		t.Fatal("disabled registration is visible")
	}
	plugin.Spec.Enabled = true
	updateStore(t, store, plugin)
	if err := registry.reconcile(ctx, plugin.Name, store); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(plugin); err != nil {
		t.Fatal(err)
	}
	if err := registry.reconcile(ctx, plugin.Name, store); err != nil {
		t.Fatal(err)
	}
	if len(registry.Entries()) != 0 {
		t.Fatal("deleted registration remains visible")
	}
	fresh, store, plugin := registryFixture(t)
	if err := fresh.reconcile(ctx, plugin.Name, store); err != nil || len(fresh.Entries()) != 1 {
		t.Fatalf("restart did not rebuild registrations: %v", err)
	}
}

func TestMissingReleaseAndInvalidEntryFailClosed(t *testing.T) {
	registry, store, plugin := registryFixture(t)
	if err := registry.reconcile(t.Context(), plugin.Name, store); err != nil {
		t.Fatal(err)
	}
	registry.read = func(context.Context, string, string) (*release.Release, error) {
		return nil, errors.New("release unavailable")
	}
	if err := registry.reconcile(t.Context(), plugin.Name, store); err == nil {
		t.Fatal("missing release was accepted")
	}
	if len(registry.Entries()) != 0 {
		t.Fatal("failed registration still serves assets")
	}
	registry.read = func(context.Context, string, string) (*release.Release, error) {
		installed := installedRelease()
		installed.Chart.Files = installed.Chart.Files[:1]
		return installed, nil
	}
	if _, err := registry.load(t.Context(), plugin); err == nil {
		t.Fatal("missing entry was accepted")
	}
	registry.read = func(context.Context, string, string) (*release.Release, error) {
		installed := installedRelease()
		installed.Chart.Files[1].Name = "frontend/../secret"
		return installed, nil
	}
	if _, err := registry.load(t.Context(), plugin); err == nil {
		t.Fatal("unsafe frontend path was accepted")
	}
}

func TestWatchObservesManualCRCreateAndDelete(t *testing.T) {
	registry, _, plugin := registryFixture(t)
	if err := registry.client.Resource(pluginapi.Resource).Delete(t.Context(), plugin.Name, metav1.DeleteOptions{}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); registry.Run(ctx) }()
	raw, err := runtime.DefaultUnstructuredConverter.ToUnstructured(plugin)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := registry.client.Resource(pluginapi.Resource).Create(ctx, &unstructured.Unstructured{Object: raw}, metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}
	waitEntries(t, registry, 1)
	if err := registry.client.Resource(pluginapi.Resource).Delete(ctx, plugin.Name, metav1.DeleteOptions{}); err != nil {
		t.Fatal(err)
	}
	waitEntries(t, registry, 0)
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("observer did not stop")
	}
}

func waitEntries(t *testing.T, registry *Registry, count int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if len(registry.Entries()) == count {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("entry count = %d, expected %d", len(registry.Entries()), count)
}
