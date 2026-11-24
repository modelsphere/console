package iam

import (
	"os"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/yaml"
)

func TestReverseProxySchemaPreservesSecretReference(t *testing.T) {
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
	required, found, err := unstructured.NestedStringSlice(directives, "properties", "authProxySecretRef", "required")
	if err != nil || !found || len(required) != 2 || required[0] != "key" || required[1] != "name" {
		t.Fatalf("Secret reference required fields=%v err=%v", required, err)
	}
	validations, found, err := unstructured.NestedSlice(directives, "x-kubernetes-validations")
	if err != nil || !found || len(validations) != 1 {
		t.Fatalf("credential authentication validation: found=%t err=%v", found, err)
	}
	if validations[0].(map[string]any)["rule"] != "!has(self.authProxySecretRef) || (has(self.authProxy) && self.authProxy && (!has(self.skipAuthentication) || !self.skipAuthentication))" {
		t.Fatal("Secret references must require authentication and reject public routes")
	}
}
