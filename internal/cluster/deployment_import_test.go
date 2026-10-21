package cluster

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	k8stesting "k8s.io/client-go/testing"
)

func importSecret(t *testing.T, revision int, status string, mutate func(map[string]any)) *unstructured.Unstructured {
	t.Helper()
	payload := map[string]any{"name": "model", "namespace": "models", "version": revision, "info": map[string]any{"status": status}, "chart": map[string]any{"metadata": map[string]any{"name": "inference", "version": "1.2.3"}}, "config": map[string]any{"serviceId": "original", "replicaCount": 2}}
	if mutate != nil {
		mutate(payload)
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return &unstructured.Unstructured{Object: map[string]any{"apiVersion": "v1", "kind": "Secret", "type": "helm.sh/release.v1", "metadata": map[string]any{"namespace": "models", "name": fmt.Sprintf("sh.helm.release.v1.model.v%d", revision), "uid": "source-uid", "resourceVersion": "7", "labels": map[string]any{"owner": "helm", "name": "model", "version": fmt.Sprint(revision), "status": status}}, "data": map[string]any{"release": base64.StdEncoding.EncodeToString([]byte(base64.StdEncoding.EncodeToString(buf.Bytes())))}}}
}

func importKube(objects ...runtime.Object) (*Kube, *dynamicfake.FakeDynamicClient) {
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{secretsGVR: "SecretList", configMapsGVR: "ConfigMapList"}, objects...)
	return NewKubeFrom(dyn), dyn
}

func TestHelmImportLatestAndSuppliedValues(t *testing.T) {
	kube, dyn := importKube(importSecret(t, 1, "superseded", nil), importSecret(t, 2, "deployed", nil))
	rel, err := kube.HelmImportRelease(t.Context(), "models", "model")
	if err != nil {
		t.Fatal(err)
	}
	if rel.Version != 2 || rel.SecretUID != "source-uid" || rel.ResourceVersion != "7" || rel.Config["serviceId"] != "original" {
		t.Fatalf("release = %+v", rel)
	}
	action := dyn.Actions()[0].(k8stesting.ListAction)
	if action.GetNamespace() != "models" || action.GetListRestrictions().Labels.String() != "name=model,owner=helm" {
		t.Fatalf("unbounded lookup: %#v", action)
	}
}

func TestHelmImportRefusesUnsafeStorage(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(map[string]any)
		status string
		want   error
	}{
		{"namespace", func(p map[string]any) { p["namespace"] = "other" }, "deployed", ErrInvalidHelmRelease},
		{"release", func(p map[string]any) { p["name"] = "other" }, "deployed", ErrInvalidHelmRelease},
		{"revision", func(p map[string]any) { p["version"] = 1 }, "deployed", ErrInvalidHelmRelease},
		{"latest pending", nil, "pending-upgrade", ErrHelmNotDeployed},
		{"latest failed", nil, "failed", ErrHelmNotDeployed},
		{"decompression bomb", func(p map[string]any) { p["manifest"] = strings.Repeat("x", MaxHelmDecodedBytes+1) }, "deployed", ErrInvalidHelmRelease},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			kube, _ := importKube(importSecret(t, 1, "deployed", nil), importSecret(t, 2, tt.status, tt.mutate))
			if _, err := kube.HelmImportRelease(t.Context(), "models", "model"); !errors.Is(err, tt.want) {
				t.Fatalf("got %v, want %v", err, tt.want)
			}
		})
	}
	for _, field := range []string{"type", "uid", "resourceVersion", "release", "labels", "name"} {
		t.Run(field, func(t *testing.T) {
			secret := importSecret(t, 2, "deployed", nil)
			switch field {
			case "type":
				secret.Object["type"] = "Opaque"
			case "uid":
				secret.SetUID("")
			case "resourceVersion":
				secret.SetResourceVersion("")
			case "release":
				_ = unstructured.SetNestedField(secret.Object, "broken", "data", "release")
			case "labels":
				labels := secret.GetLabels()
				labels["version"] = "3"
				secret.SetLabels(labels)
			case "name":
				secret.SetName("wrong")
			}
			kube, _ := importKube(secret)
			if _, err := kube.HelmImportRelease(t.Context(), "models", "model"); !errors.Is(err, ErrInvalidHelmRelease) {
				t.Fatalf("got %v", err)
			}
		})
	}
}

func TestHelmImportRejectsIncompleteHistory(t *testing.T) {
	kube, dyn := importKube()
	dyn.PrependReactor("list", "secrets", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, &unstructured.UnstructuredList{Object: map[string]any{"metadata": map[string]any{"continue": "more"}}, Items: []unstructured.Unstructured{*importSecret(t, 1, "deployed", nil)}}, nil
	})
	if _, err := kube.HelmImportRelease(t.Context(), "models", "model"); !errors.Is(err, ErrInvalidHelmRelease) {
		t.Fatalf("pagination got %v", err)
	}
	objects := []runtime.Object{}
	for i := 1; i <= MaxHelmRevisions+1; i++ {
		objects = append(objects, importSecret(t, i, "deployed", nil))
	}
	kube, _ = importKube(objects...)
	if _, err := kube.HelmImportRelease(t.Context(), "models", "model"); !errors.Is(err, ErrInvalidHelmRelease) {
		t.Fatalf("count got %v", err)
	}
}

func TestImportedPlanCreateOnly(t *testing.T) {
	kube, dyn := importKube()
	data := map[string]string{"plan.yaml": "apiVersion: plan.swiss/v1\n"}
	if err := kube.CreateImportedPlan(t.Context(), "models", "swiss-plan-model", data, map[string]string{"actor": "operator"}); err != nil {
		t.Fatal(err)
	}
	if err := kube.CreateImportedPlan(t.Context(), "models", "swiss-plan-model", data, nil); err == nil {
		t.Fatal("second create overwrote existing plan")
	}
	obj, err := dyn.Resource(configMapsGVR).Namespace("models").Get(t.Context(), "swiss-plan-model", metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if obj.GetLabels()["app.kubernetes.io/managed-by"] != "swiss" || obj.GetAnnotations()["actor"] != "operator" {
		t.Fatalf("metadata = %#v", obj.Object)
	}
	for _, action := range dyn.Actions() {
		if action.GetVerb() == "update" || action.GetVerb() == "patch" {
			t.Fatalf("unsafe write: %v", action)
		}
	}
}
