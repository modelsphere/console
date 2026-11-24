package server

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	pluginapi "github.com/modelsphere/console/api/plugin/v1alpha1"
	"github.com/modelsphere/console/internal/iam"
	"github.com/modelsphere/console/internal/pluginregistry"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	k8stesting "k8s.io/client-go/testing"
)

func credentialProxyServer(t *testing.T, upstream http.HandlerFunc) (*Server, http.Handler, string, string, *pluginregistry.Entry) {
	t.Helper()
	backend := httptest.NewServer(upstream)
	t.Cleanup(backend.Close)
	target, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}
	entry := registeredEntry(t, target)
	entry.Plugin.Spec.Chart = pluginapi.ChartConfig{Namespace: "plugins"}
	entry.Routes[0].Spec.Directives.AuthProxySecretRef = &iam.ProxySecretReference{Name: "example-proxy", Key: "proxyKey"}
	srv, handler, admin, bob := pluginRegistryServer(t, entry)
	return srv, handler, admin, bob, entry
}

func setProxyCredential(t *testing.T, srv *Server, value string, create bool) {
	t.Helper()
	if err := srv.kube.WriteSecret(context.Background(), "plugins", "example-proxy", map[string][]byte{"proxyKey": []byte(value)}, create, ""); err != nil {
		t.Fatal(err)
	}
}

func TestPluginProxyInjectsCredentialAndObservesRotation(t *testing.T) {
	var received http.Header
	srv, handler, admin, _, _ := credentialProxyServer(t, func(writer http.ResponseWriter, request *http.Request) {
		received = request.Header.Clone()
		writer.WriteHeader(http.StatusNoContent)
	})
	for index, credential := range []string{"first-key", "rotated-key"} {
		setProxyCredential(t, srv, credential, index == 0)
		request := httptest.NewRequest("GET", "/api/example/ping", nil)
		if index == 0 {
			request.AddCookie(&http.Cookie{Name: "token", Value: admin})
		} else {
			request.Header.Set("Authorization", "Bearer "+admin)
		}
		request.Header.Set("X-Remote-User", "forged")
		request.Header.Set("X-Remote-Group", "forged")
		request.Header.Set("X-Remote-Extra-Scope", "forged")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusNoContent {
			t.Fatalf("proxy status=%d body=%s", response.Code, response.Body.String())
		}
		if received.Get("Authorization") != "Bearer "+credential || received.Get("X-Remote-User") != "admin" {
			t.Fatal("proxy did not replace caller credential and identity")
		}
		if received.Get("Cookie") != "" || received.Get("X-Remote-Extra-Scope") != "" || strings.Contains(strings.Join(received.Values("X-Remote-Group"), ","), "forged") {
			t.Fatal("client identity or cookies leaked upstream")
		}
	}
	if err := srv.kube.Dynamic().Resource(schema.GroupVersionResource{Version: "v1", Resource: "secrets"}).Namespace("plugins").Delete(context.Background(), "example-proxy", metav1.DeleteOptions{}); err != nil {
		t.Fatal(err)
	}
	received = nil
	if response := do(handler, "GET", "/api/example/ping", admin, ""); response.Code != http.StatusBadGateway || received != nil {
		t.Fatal("deleted credential did not fail closed")
	}
}

func TestPluginCredentialFailuresNeverReachUpstream(t *testing.T) {
	for _, scenario := range []string{"missing", "empty", "missing key", "newline", "spaces", "forbidden", "no client", "wrong namespace", "missing namespace"} {
		t.Run(scenario, func(t *testing.T) {
			calls := 0
			srv, handler, admin, _, entry := credentialProxyServer(t, func(http.ResponseWriter, *http.Request) { calls++ })
			var logs bytes.Buffer
			srv.log = slog.New(slog.NewTextHandler(&logs, nil))
			configureCredentialFailure(t, srv, entry, scenario)
			response := do(handler, "GET", "/api/example/ping", admin, "")
			if response.Code != http.StatusBadGateway || calls != 0 {
				t.Fatalf("status=%d upstream calls=%d", response.Code, calls)
			}
			for _, output := range []string{response.Body.String(), logs.String()} {
				if strings.Contains(output, "sensitive-value") || strings.Contains(output, admin) {
					t.Fatal("credentials leaked in error or log")
				}
			}
		})
	}
}

func configureCredentialFailure(t *testing.T, srv *Server, entry *pluginregistry.Entry, scenario string) {
	t.Helper()
	switch scenario {
	case "missing":
	case "empty", "missing key", "newline", "spaces":
		values := map[string]string{"empty": "", "missing key": "sensitive-value", "newline": "sensitive-value\r\nInjected: yes", "spaces": "sensitive-value extra"}
		setProxyCredential(t, srv, values[scenario], true)
		if scenario == "missing key" {
			entry.Routes[0].Spec.Directives.AuthProxySecretRef.Key = "absent"
		}
	case "forbidden":
		srv.kube.Dynamic().(*dynamicfake.FakeDynamicClient).PrependReactor("get", "secrets", func(k8stesting.Action) (bool, runtime.Object, error) {
			return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "secrets"}, "example-proxy", fmt.Errorf("sensitive-value"))
		})
	case "no client":
		srv.kube = nil
	case "wrong namespace":
		setProxyCredential(t, srv, "sensitive-value", true)
		entry.Routes[0].Namespace = "other"
	case "missing namespace":
		entry.Plugin.Spec.Chart.Namespace = ""
	}
}

func TestPluginAuthorizationPrecedesSecretRead(t *testing.T) {
	srv, handler, _, bob, _ := credentialProxyServer(t, func(http.ResponseWriter, *http.Request) { t.Error("unauthorized upstream request") })
	reads := 0
	srv.kube.Dynamic().(*dynamicfake.FakeDynamicClient).PrependReactor("get", "secrets", func(k8stesting.Action) (bool, runtime.Object, error) {
		reads++
		return true, nil, fmt.Errorf("unexpected secret read")
	})
	for _, caller := range []struct {
		token string
		code  int
	}{{"", http.StatusUnauthorized}, {bob, http.StatusForbidden}} {
		if response := do(handler, "GET", "/api/example/ping", caller.token, ""); response.Code != caller.code {
			t.Fatalf("authorization: status=%d want=%d", response.Code, caller.code)
		}
	}
	if reads != 0 {
		t.Fatalf("unauthorized secret reads=%d", reads)
	}
}
