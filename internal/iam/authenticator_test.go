package iam

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	k8stesting "k8s.io/client-go/testing"
)

func TestLoginPreservesUserReadErrors(t *testing.T) {
	for _, cause := range []error{
		context.DeadlineExceeded,
		context.Canceled,
		errors.New("connection refused"),
		apierrors.NewForbidden(UsersGVR.GroupResource(), "admin", errors.New("access denied")),
		apierrors.NewUnauthorized("cluster credentials expired"),
	} {
		t.Run(cause.Error(), func(t *testing.T) {
			dyn := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme())
			dyn.PrependReactor("get", "users", func(k8stesting.Action) (bool, runtime.Object, error) {
				return true, nil, cause
			})
			authn := NewAuthenticator(NewStore(dyn), NewSigner("https://issuer.example.com", "test-only", time.Hour), slog.New(slog.DiscardHandler))
			token, err := authn.Login(t.Context(), "admin", "test-password")
			if token != nil || !errors.Is(err, cause) || errors.Is(err, ErrAuth) {
				t.Fatalf("Login() = %v, %v; want the user-read error, not ErrAuth", token, err)
			}
		})
	}
}

func TestLoginMissingUserRemainsACredentialFailure(t *testing.T) {
	dyn := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme())
	authn := NewAuthenticator(NewStore(dyn), NewSigner("https://issuer.example.com", "test-only", time.Hour), slog.New(slog.DiscardHandler))
	token, err := authn.Login(t.Context(), "missing", "test-password")
	if token != nil || !errors.Is(err, ErrAuth) || err.Error() != ErrAuth.Error() {
		t.Fatalf("Login() = %v, %v; want the generic credential error", token, err)
	}
}
