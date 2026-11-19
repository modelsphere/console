package v1alpha1

import (
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

var GroupVersion = schema.GroupVersion{Group: "modelsphere.dev", Version: "v1alpha1"}
var SchemeBuilder = runtime.NewSchemeBuilder()
var AddToScheme = SchemeBuilder.AddToScheme
var Resource = GroupVersion.WithResource("plugins")
