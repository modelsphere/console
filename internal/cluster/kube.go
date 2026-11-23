// Package cluster is console's access to Kubernetes, where the iam CRDs
// (User, IAMRole, IAMRoleBinding under iam.theriseunion.io) live.
//
// It uses the dynamic client rather than a typed clientset: the iam types are
// CRDs, and a dynamic client reads and writes them as unstructured objects
// without registering a scheme or generating clients -- enough for the CRUD the
// portal needs, and one less code-generation step to keep in sync with Global.
package cluster

import (
	"context"
	"encoding/base64"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

var (
	configMapsGVR = schema.GroupVersionResource{Version: "v1", Resource: "configmaps"}
	secretsGVR    = schema.GroupVersionResource{Version: "v1", Resource: "secrets"}
)

type Kube struct {
	dyn dynamic.Interface
	// For what the dynamic client cannot do: pod logs are a subresource stream.
	typed kubernetes.Interface
}

// NewKube builds a client. An empty kubeconfig means in-cluster first, then the
// usual loading rules -- the same fallback swissd uses.
func NewKube(kubeconfig, context_ string) (*Kube, error) {
	cfg, err := restConfig(kubeconfig, context_)
	if err != nil {
		return nil, err
	}
	dyn, err := dynamic.NewForConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("dynamic client: %w", err)
	}
	typed, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("clientset: %w", err)
	}
	return &Kube{dyn: dyn, typed: typed}, nil
}

// NewKubeFrom wraps a dynamic client the caller already has, which is how tests
// hand this package a fake.
func NewKubeFrom(dyn dynamic.Interface) *Kube { return &Kube{dyn: dyn} }

// WithTyped adds a clientset to a Kube built from a dynamic client alone.
func (k *Kube) WithTyped(typed kubernetes.Interface) *Kube {
	k.typed = typed
	return k
}

// Dynamic exposes the dynamic client for the iam store to build resource
// clients against the iam.theriseunion.io GroupVersionResources.
func (k *Kube) Dynamic() dynamic.Interface { return k.dyn }

// Typed exposes the clientset for Helm's existing Secret storage driver.
func (k *Kube) Typed() kubernetes.Interface { return k.typed }

// ConfigMap reads one ConfigMap's data. The gateway resolver reads two: the site
// profile, and the openresty route list beside it.
func (k *Kube) ConfigMap(ctx context.Context, namespace, name string) (map[string]string, error) {
	obj, err := k.dyn.Resource(configMapsGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	data, _, err := unstructured.NestedStringMap(obj.Object, "data")
	if err != nil {
		return nil, fmt.Errorf("configmap %s/%s: %w", namespace, name, err)
	}
	return data, nil
}

// Secret reads one Secret's entries, decoded. The gateway keeps its keys in a
// file rather than an environment variable -- nginx re-reads files on reload,
// never env -- so there is no env var to point at and console reads the Secret
// itself. That read is the whole reason its role needs secrets at all.
func (k *Kube) Secret(ctx context.Context, namespace, name string) (map[string][]byte, error) {
	obj, err := k.dyn.Resource(secretsGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	return decodeSecret(obj, namespace, name)
}

// SecretVersioned reads a Secret with its resourceVersion, for a read-modify-write
// through WriteSecret. A missing Secret is the apierrors NotFound.
func (k *Kube) SecretVersioned(ctx context.Context, namespace, name string) (map[string][]byte, string, error) {
	obj, err := k.dyn.Resource(secretsGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, "", err
	}
	data, err := decodeSecret(obj, namespace, name)
	return data, obj.GetResourceVersion(), err
}

// WriteSecret creates the Secret, or replaces its data failing with Conflict if
// it changed since resourceVersion.
func (k *Kube) WriteSecret(ctx context.Context, namespace, name string, data map[string][]byte, create bool, resourceVersion string) error {
	encoded := make(map[string]any, len(data))
	for key, value := range data {
		encoded[key] = base64.StdEncoding.EncodeToString(value)
	}
	obj := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1",
		"kind":       "Secret",
		"metadata": map[string]any{
			"name":      name,
			"namespace": namespace,
			"labels":    map[string]any{"app.kubernetes.io/managed-by": "console"},
		},
		"type": "Opaque",
		"data": encoded,
	}}
	client := k.dyn.Resource(secretsGVR).Namespace(namespace)
	if create {
		_, err := client.Create(ctx, obj, metav1.CreateOptions{})
		return err
	}
	obj.SetResourceVersion(resourceVersion)
	_, err := client.Update(ctx, obj, metav1.UpdateOptions{})
	return err
}

func decodeSecret(obj *unstructured.Unstructured, namespace, name string) (map[string][]byte, error) {
	data, _, err := unstructured.NestedStringMap(obj.Object, "data")
	if err != nil {
		return nil, fmt.Errorf("secret %s/%s: %w", namespace, name, err)
	}
	out := make(map[string][]byte, len(data))
	for key, value := range data {
		decoded, err := base64.StdEncoding.DecodeString(value)
		if err != nil {
			return nil, fmt.Errorf("secret %s/%s: entry %q is not base64", namespace, name, key)
		}
		out[key] = decoded
	}
	return out, nil
}

func restConfig(kubeconfig, context_ string) (*rest.Config, error) {
	if kubeconfig == "" && context_ == "" {
		if cfg, err := rest.InClusterConfig(); err == nil {
			return cfg, nil
		}
	}
	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	if kubeconfig != "" {
		rules.ExplicitPath = kubeconfig
	}
	overrides := &clientcmd.ConfigOverrides{}
	if context_ != "" {
		overrides.CurrentContext = context_
	}
	cfg, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(rules, overrides).ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("kubeconfig: %w", err)
	}
	return cfg, nil
}
