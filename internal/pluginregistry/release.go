package pluginregistry

import (
	"context"
	"fmt"
	"io"
	"strings"

	pluginapi "github.com/modelsphere/console/api/plugin/v1alpha1"
	"github.com/modelsphere/console/internal/config"
	"github.com/modelsphere/console/internal/iam"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage"
	"helm.sh/helm/v3/pkg/storage/driver"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/yaml"
	"k8s.io/client-go/kubernetes"
	typedcore "k8s.io/client-go/kubernetes/typed/core/v1"
	sigyaml "sigs.k8s.io/yaml"
)

type contextSecrets struct {
	typedcore.SecretInterface
	ctx context.Context
}

func (s contextSecrets) List(_ context.Context, options metav1.ListOptions) (*corev1.SecretList, error) {
	return s.SecretInterface.List(s.ctx, options)
}

// HelmReader uses Helm's standard Secret driver; no install or upgrade APIs.
func HelmReader(client kubernetes.Interface) ReleaseReader {
	return func(ctx context.Context, namespace, name string) (*release.Release, error) {
		secrets := contextSecrets{SecretInterface: client.CoreV1().Secrets(namespace), ctx: ctx}
		return storage.Init(driver.NewSecrets(secrets)).Last(name)
	}
}

func (r *Registry) load(ctx context.Context, plugin *pluginapi.Plugin) (*Entry, error) {
	identity, valid := pluginapi.ParsePluginResourceName(plugin.Name)
	if !valid {
		return nil, fmt.Errorf("invalid ModelSphere plugin identity")
	}
	if plugin.Spec.Scope != "" && plugin.Spec.Scope != "platform" {
		return nil, fmt.Errorf("workspace-scoped registrations are not supported by this Console")
	}
	if plugin.Spec.Type != pluginapi.PluginTypeHelm {
		return nil, fmt.Errorf("only installed Helm registrations are supported")
	}
	name := plugin.Spec.Chart.ReleaseName
	if name == "" {
		name = plugin.Name
	}
	if plugin.Spec.Chart.Namespace == "" {
		return nil, fmt.Errorf("spec.chart.namespace is required")
	}
	installed, err := r.read(ctx, plugin.Spec.Chart.Namespace, name)
	if err != nil {
		return nil, fmt.Errorf("read installed plugin release: %w", err)
	}
	if installed.Info == nil || installed.Info.Status != release.StatusDeployed || installed.Chart == nil {
		return nil, fmt.Errorf("plugin release is not deployed")
	}
	if installed.Chart.Metadata.Name != plugin.Spec.Chart.Name || (plugin.Spec.Version != "" && installed.Chart.Metadata.Version != plugin.Spec.Version) {
		return nil, fmt.Errorf("installed Chart does not match registration")
	}
	entry := &Entry{Plugin: *plugin.DeepCopy(), Files: map[string][]byte{}}
	meta := &pluginapi.PluginMeta{}
	for _, file := range installed.Chart.Files {
		if file.Name == "plugin.yaml" {
			if err := sigyaml.UnmarshalStrict(file.Data, meta); err != nil {
				return nil, fmt.Errorf("parse Global plugin metadata: %w", err)
			}
		}
		if strings.HasPrefix(file.Name, "frontend/") {
			asset := strings.TrimPrefix(file.Name, "frontend/")
			if !config.ValidPluginAsset(asset) {
				return nil, fmt.Errorf("invalid frontend asset %q", asset)
			}
			entry.Files[asset] = file.Data
		}
	}
	if meta.Group != identity.Group || meta.Name != identity.Name || meta.APIVersion != "v1" {
		return nil, fmt.Errorf("Chart plugin metadata does not match registration identity")
	}
	if meta.Frontend.Type != "component" || meta.Frontend.Runtime != "remote" || !config.ValidPluginAsset(meta.Frontend.Entry) {
		return nil, fmt.Errorf("plugin requires a remote component frontend")
	}
	if len(entry.Files[meta.Frontend.Entry]) == 0 {
		return nil, fmt.Errorf("frontend entry missing from installed Chart")
	}
	entry.Routes, err = readRoutes(installed.Manifest)
	if err != nil {
		return nil, err
	}
	entry.Plugin.Status = pluginapi.PluginStatus{Phase: pluginapi.PluginPhaseInstalled, ObservedGeneration: plugin.Generation, ReleaseName: installed.Name, ReleaseVersion: installed.Version, PluginMeta: meta, FrontendStatus: &pluginapi.FrontendStatus{Distributed: true, EntryURL: "/plugins/" + plugin.Name + "/" + meta.Frontend.Entry}}
	return entry, nil
}

// Route uses Global's ReverseProxy fields independently of the Plugin schema.
type Route = iam.ReverseProxy

func readRoutes(manifest string) ([]Route, error) {
	decoder := yaml.NewYAMLOrJSONDecoder(strings.NewReader(manifest), 4096)
	routes := []Route{}
	for {
		var obj map[string]any
		err := decoder.Decode(&obj)
		if err == io.EOF {
			return routes, nil
		}
		if err != nil {
			return nil, fmt.Errorf("parse installed release resources: %w", err)
		}
		if obj["kind"] != "ReverseProxy" || obj["apiVersion"] != iam.Group+"/"+iam.Version {
			continue
		}
		data, err := sigyaml.Marshal(obj)
		if err != nil {
			return nil, err
		}
		var route Route
		if err := sigyaml.Unmarshal(data, &route); err != nil {
			return nil, err
		}
		prefix := strings.TrimSuffix(route.Spec.Matcher.Path, "*")
		if !strings.HasPrefix(prefix, "/api/") || !strings.HasSuffix(prefix, "/") || !route.Spec.Directives.AuthProxy {
			return nil, fmt.Errorf("plugin ReverseProxy must authenticate an /api/ prefix")
		}
		if (route.Spec.Upstream.Scheme != "http" && route.Spec.Upstream.Scheme != "https") || route.Spec.Upstream.Host == "" || route.Spec.Upstream.Port < 1 || route.Spec.Upstream.Port > 65535 {
			return nil, fmt.Errorf("invalid plugin ReverseProxy upstream")
		}
		routes = append(routes, route)
	}
}
