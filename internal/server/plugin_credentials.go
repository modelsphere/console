package server

import (
	"context"
	"fmt"
	"regexp"

	"github.com/modelsphere/console/internal/pluginregistry"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

var proxyBearerToken = regexp.MustCompile(`^[A-Za-z0-9._~+/-]+=*$`)

func (s *Server) setPluginCredential(ctx context.Context, namespace string, route pluginregistry.Route, target *backendTarget) error {
	reference := route.Spec.Directives.AuthProxySecretRef
	if reference == nil {
		return nil
	}
	if !route.Spec.Directives.AuthProxy || route.Spec.Directives.SkipAuthentication {
		return fmt.Errorf("credential requires an authenticated proxy route")
	}
	if namespace == "" || (route.Namespace != "" && route.Namespace != namespace) {
		return fmt.Errorf("credential route must use the installed release namespace")
	}
	if s.kube == nil {
		return fmt.Errorf("Kubernetes client is unavailable")
	}
	// Read after IAM on every request so revocation never falls back to a stale key.
	secret, err := s.kube.Secret(ctx, namespace, reference.Name)
	if err != nil {
		// Kubernetes errors may contain response bodies; log only a bounded category.
		switch {
		case apierrors.IsNotFound(err):
			return fmt.Errorf("proxy Secret not found")
		case apierrors.IsForbidden(err):
			return fmt.Errorf("proxy Secret access forbidden")
		default:
			return fmt.Errorf("proxy Secret read failed")
		}
	}
	credential := secret[reference.Key]
	if !proxyBearerToken.Match(credential) {
		return fmt.Errorf("proxy Secret key is missing, empty, or not a valid bearer token")
	}
	target.header, target.key = "Authorization", "Bearer "+string(credential)
	return nil
}
