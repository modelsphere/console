package iam

import (
	"os"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/yaml"
)

func TestReverseProxySchemaUsesExistingAuthProxyContract(t *testing.T) {
	data, err := os.ReadFile("../../helm/console/crds/iam.theriseunion.io_reverseproxies.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var schema map[string]any
	if err := yaml.Unmarshal(data, &schema); err != nil {
		t.Fatal(err)
	}
	versions, found, err := unstructured.NestedSlice(schema, "spec", "versions")
	if err != nil || !found || len(versions) != 1 {
		t.Fatalf("schema versions: found=%t err=%v", found, err)
	}
	directives, found, err := unstructured.NestedMap(versions[0].(map[string]any), "schema", "openAPIV3Schema", "properties", "spec", "properties", "directives")
	if err != nil || !found {
		t.Fatalf("schema directives: found=%t err=%v", found, err)
	}
	if _, found, err := unstructured.NestedFieldNoCopy(directives, "properties", "authProxySecretRef"); err != nil || found {
		t.Fatalf("unsupported Secret reference: found=%t err=%v", found, err)
	}
	fieldType, found, err := unstructured.NestedString(directives, "properties", "authProxy", "type")
	if err != nil || !found || fieldType != "boolean" {
		t.Fatalf("authProxy type=%q found=%t err=%v", fieldType, found, err)
	}
}
