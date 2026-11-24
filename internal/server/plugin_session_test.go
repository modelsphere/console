package server

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	k8stesting "k8s.io/client-go/testing"
)

func TestPluginProxyForwardsSessionWithoutSecretReads(t *testing.T) {
	var received http.Header
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		received = request.Header.Clone()
		writer.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(upstream.Close)
	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	srv, handler, admin, _ := pluginRegistryServer(t, registeredEntry(t, target))
	srv.kube.Dynamic().(*dynamicfake.FakeDynamicClient).PrependReactor("get", "secrets", func(k8stesting.Action) (bool, runtime.Object, error) {
		t.Error("plugin authProxy must not read backend Secrets")
		return true, nil, fmt.Errorf("unexpected Secret read")
	})
	for _, cookie := range []bool{false, true} {
		request := httptest.NewRequest(http.MethodGet, "/api/example/ping", nil)
		if cookie {
			request.AddCookie(&http.Cookie{Name: "token", Value: admin})
		} else {
			request.Header.Set("Authorization", "Bearer "+admin)
		}
		request.Header.Set("X-Remote-User", "forged")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusNoContent {
			t.Fatalf("proxy status=%d body=%s", response.Code, response.Body.String())
		}
		if received.Get("Authorization") != "Bearer "+admin || received.Get("X-Remote-User") != "admin" || received.Get("Cookie") != "" {
			t.Fatal("proxy must preserve the session and verified identity without forwarding cookies")
		}
	}
}
