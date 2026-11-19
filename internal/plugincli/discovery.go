package plugincli

import (
	"context"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/metadata"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// helmReleaseSelector matches the Secret labels Helm writes on release records.
const helmReleaseSelector = "owner=helm,status=deployed"

// helmMetadataPageSize bounds each list response. A release Secret carries the
// packaged chart and values, so an unbounded cluster-wide list is tens of
// megabytes on a busy cluster and can be cut off in transit.
const helmMetadataPageSize = 500

// helmSecretResource is the core/v1 collection holding release records.
var helmSecretResource = schema.GroupVersionResource{Version: "v1", Resource: "secrets"}

// metadataLister lists object metadata. client-go's metadata client implements
// it for any resource; tests supply their own pages.
type metadataLister interface {
	List(ctx context.Context, options metav1.ListOptions) (*metav1.PartialObjectMetadataList, error)
}

// ListDeployedReleases returns deployed Helm releases from release Secret
// metadata. Discovery needs only the name, namespace and status labels, so it
// asks for object metadata rather than the Secret bodies that carry the chart.
func (r Runner) ListDeployedReleases(ctx context.Context) ([]HelmRelease, error) {
	if r.CommandTimeout <= 0 {
		return nil, fmt.Errorf("command timeout must be positive")
	}
	ctx, cancel := context.WithTimeout(ctx, r.CommandTimeout)
	defer cancel()
	lister, err := r.releaseLister()
	if err != nil {
		return nil, fmt.Errorf("list deployed Helm releases: %w", err)
	}
	options := metav1.ListOptions{LabelSelector: helmReleaseSelector, Limit: helmMetadataPageSize}
	releases := make([]HelmRelease, 0, helmMetadataPageSize)
	for {
		page, err := lister.List(ctx, options)
		if err != nil {
			return nil, fmt.Errorf("list deployed Helm releases: %w", err)
		}
		for _, item := range page.Items {
			if release, ok := releaseFromSecretMetadata(item); ok {
				releases = append(releases, release)
			}
		}
		if page.GetContinue() == "" {
			break
		}
		options.Continue = page.GetContinue()
	}
	r.log(2, "discovered %d deployed Helm releases", len(releases))
	return releases, nil
}

// releaseLister returns the injected lister, or one built from the kubeconfig
// and context the rest of the CLI uses.
func (r Runner) releaseLister() (metadataLister, error) {
	if r.secretMetadata != nil {
		return r.secretMetadata, nil
	}
	config, err := r.clientConfig()
	if err != nil {
		return nil, err
	}
	client, err := metadata.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("create Kubernetes metadata client: %w", err)
	}
	return client.Resource(helmSecretResource), nil
}

// clientConfig resolves the same kubeconfig and context flags kubectl and helm
// receive, honouring KUBECONFIG when no path was configured.
func (r Runner) clientConfig() (*rest.Config, error) {
	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	if r.Kubeconfig != "" {
		rules.ExplicitPath = r.Kubeconfig
	}
	overrides := &clientcmd.ConfigOverrides{CurrentContext: r.Context}
	config, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(rules, overrides).ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("load Kubernetes client configuration: %w", err)
	}
	return config, nil
}

// releaseFromSecretMetadata turns a release Secret's metadata into a release,
// skipping records without the labels or namespace discovery needs.
func releaseFromSecretMetadata(item metav1.PartialObjectMetadata) (HelmRelease, bool) {
	labels := item.GetLabels()
	name := labels["name"]
	status := labels["status"]
	if name == "" || status != "deployed" || item.GetNamespace() == "" {
		return HelmRelease{}, false
	}
	return HelmRelease{
		Name:      name,
		Namespace: item.GetNamespace(),
		Status:    status,
		Chart:     labels["chart"],
	}, true
}
