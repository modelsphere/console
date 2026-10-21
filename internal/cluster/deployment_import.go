package cluster

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	apimeta "k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

const (
	MaxHelmRevisions       = 32
	MaxHelmCompressedBytes = 1 << 20
	MaxHelmDecodedBytes    = 8 << 20
)

var ErrInvalidHelmRelease = errors.New("Helm release storage is invalid or exceeds import limits")
var ErrHelmNotDeployed = errors.New("latest Helm revision is not deployed")
var ErrHelmNotFound = errors.New("Helm release was not found")

type HelmImportRelease struct {
	Name      string         `json:"name"`
	Namespace string         `json:"namespace"`
	Version   int            `json:"version"`
	Config    map[string]any `json:"config"`
	Info      struct {
		Status string `json:"status"`
	} `json:"info"`
	Chart struct {
		Metadata struct {
			Name    string `json:"name"`
			Version string `json:"version"`
		} `json:"metadata"`
	} `json:"chart"`
	SecretUID       string `json:"-"`
	ResourceVersion string `json:"-"`
}

func (k *Kube) HelmImportRelease(ctx context.Context, namespace, release string) (*HelmImportRelease, error) {
	list, err := k.dyn.Resource(secretsGVR).Namespace(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: "owner=helm,name=" + release, Limit: MaxHelmRevisions + 1,
	})
	if err != nil {
		return nil, err
	}
	if len(list.Items) == 0 {
		return nil, ErrHelmNotFound
	}
	if len(list.Items) > MaxHelmRevisions || list.GetContinue() != "" {
		return nil, ErrInvalidHelmRelease
	}
	newest, revision := -1, 0
	total := 0
	seen := map[int]bool{}
	for i := range list.Items {
		s := &list.Items[i]
		labels := s.GetLabels()
		n, err := strconv.Atoi(labels["version"])
		if err != nil || n <= 0 || seen[n] || labels["owner"] != "helm" || labels["name"] != release || s.GetNamespace() != namespace || s.GetName() != fmt.Sprintf("sh.helm.release.v1.%s.v%d", release, n) {
			return nil, ErrInvalidHelmRelease
		}
		seen[n] = true
		raw, _, err := unstructured.NestedString(s.Object, "data", "release")
		if err != nil || len(raw) == 0 || len(raw) > base64.StdEncoding.EncodedLen(base64.StdEncoding.EncodedLen(MaxHelmCompressedBytes)) {
			return nil, ErrInvalidHelmRelease
		}
		total += len(raw)
		if total > 16<<20 {
			return nil, ErrInvalidHelmRelease
		}
		if n > revision {
			newest, revision = i, n
		}
	}
	return decodeHelmImport(&list.Items[newest], namespace, release, revision)
}

func decodeHelmImport(s *unstructured.Unstructured, namespace, release string, revision int) (*HelmImportRelease, error) {
	invalid := func() (*HelmImportRelease, error) { return nil, ErrInvalidHelmRelease }
	typ, _, _ := unstructured.NestedString(s.Object, "type")
	if typ != "helm.sh/release.v1" || s.GetUID() == "" || s.GetResourceVersion() == "" {
		return invalid()
	}
	raw, _, _ := unstructured.NestedString(s.Object, "data", "release")
	encoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(encoded) > base64.StdEncoding.EncodedLen(MaxHelmCompressedBytes) {
		return invalid()
	}
	compressed, err := base64.StdEncoding.DecodeString(string(encoded))
	if err != nil || len(compressed) > MaxHelmCompressedBytes {
		return invalid()
	}
	decoded := compressed
	if len(compressed) >= 2 && compressed[0] == 0x1f && compressed[1] == 0x8b {
		zr, err := gzip.NewReader(bytes.NewReader(compressed))
		if err != nil {
			return invalid()
		}
		decoded, err = io.ReadAll(io.LimitReader(zr, MaxHelmDecodedBytes+1))
		closeErr := zr.Close()
		if err != nil || closeErr != nil {
			return invalid()
		}
	}
	if len(decoded) > MaxHelmDecodedBytes {
		return invalid()
	}
	var hr HelmImportRelease
	if err := json.Unmarshal(decoded, &hr); err != nil {
		return invalid()
	}
	if hr.Name != release || hr.Namespace != namespace || hr.Version != revision || hr.Chart.Metadata.Name == "" || hr.Chart.Metadata.Version == "" {
		return invalid()
	}
	if hr.Info.Status != "deployed" || s.GetLabels()["status"] != "deployed" {
		return nil, ErrHelmNotDeployed
	}
	hr.SecretUID, hr.ResourceVersion = string(s.GetUID()), s.GetResourceVersion()
	return &hr, nil
}

var importLLMServicesGVR = schema.GroupVersionResource{Group: "serving.modelsphere.dev", Version: "v1alpha1", Resource: "llmservices"}

func (k *Kube) ImportHasLLMService(ctx context.Context, namespace, release string) (bool, error) {
	_, err := k.dyn.Resource(importLLMServicesGVR).Namespace(namespace).Get(ctx, release, metav1.GetOptions{})
	if apierrors.IsNotFound(err) || apimeta.IsNoMatchError(err) {
		return false, nil
	}
	return err == nil, err
}

func (k *Kube) CreateImportedPlan(ctx context.Context, namespace, name string, data, annotations map[string]string) error {
	obj := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1", "kind": "ConfigMap",
		"metadata": map[string]any{"name": name, "namespace": namespace},
	}}
	obj.SetLabels(map[string]string{"app.kubernetes.io/managed-by": "swiss"})
	obj.SetAnnotations(annotations)
	if err := unstructured.SetNestedStringMap(obj.Object, data, "data"); err != nil {
		return err
	}
	_, err := k.dyn.Resource(configMapsGVR).Namespace(namespace).Create(ctx, obj, metav1.CreateOptions{})
	return err
}
