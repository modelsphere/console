package v1alpha1

import (
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

var GroupVersion = schema.GroupVersion{Group: "iam.theriseunion.io", Version: "v1alpha1"}
var SchemeBuilder = runtime.NewSchemeBuilder()
var AddToScheme = SchemeBuilder.AddToScheme
