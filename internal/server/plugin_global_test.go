package server

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestGlobalPluginCurrentClusterProxy(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		fmt.Fprintf(writer, "%s %s %s", request.URL.RequestURI(), request.Header.Get("X-Remote-User"), request.Header.Get("X-Remote-Group"))
	}))
	defer upstream.Close()
	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	entry := registeredEntry(t, target)
	entry.Routes[0].Spec.Matcher.Path = "/oapis/dashboard.rise.io/v1alpha1/*"
	entry.Routes[0].Spec.Directives.StripPathPrefix = "/oapis/dashboard.rise.io/v1alpha1"
	srv, handler, admin, bob := pluginRegistryServer(t, entry)
	for _, prefix := range []string{"", "/clusters/current", "/clusters/another-id"} {
		path := prefix + "/oapis/dashboard.rise.io/v1alpha1/api/v1/pods?limit=10"
		if response := do(handler, "GET", path, "", ""); response.Code != http.StatusUnauthorized {
			t.Fatalf("anonymous %s: %d", path, response.Code)
		}
		if response := do(handler, "GET", path, bob, ""); response.Code != http.StatusForbidden {
			t.Fatalf("unauthorized %s: %d", path, response.Code)
		}
		response := do(handler, "GET", path, admin, "")
		if response.Code != http.StatusOK || response.Body.String() != "/api/v1/pods?limit=10 admin system:authenticated" {
			t.Fatalf("%s: %d %s", path, response.Code, response.Body.String())
		}
	}
	setRequirePasswordReset(t, srv, true)
	for _, prefix := range []string{"", "/clusters/current", "/clusters/another-id"} {
		if response := do(handler, "GET", prefix+"/oapis/dashboard.rise.io/v1alpha1/healthz", admin, ""); response.Code != http.StatusForbidden {
			t.Fatalf("password reset required %s: %d", prefix, response.Code)
		}
	}
}

func TestGlobalPluginPublicAssetsCarryNoIdentity(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "" || request.Header.Get("Cookie") != "" || request.Header.Get("X-Remote-User") != "" || request.Header.Get("X-Remote-Group") != "" {
			t.Error("public asset received caller credentials")
		}
		fmt.Fprint(writer, request.URL.Path)
	}))
	defer upstream.Close()
	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	entry := registeredEntry(t, target)
	entry.Routes[0].Spec.Matcher.Path = "/oapis/modelsphere.dev/v1/example/*"
	entry.Routes[0].Spec.Matcher.Method = "GET"
	entry.Routes[0].Spec.Directives.AuthProxy = false
	entry.Routes[0].Spec.Directives.SkipAuthentication = true
	entry.Routes[0].Spec.Directives.StripPathPrefix = "/oapis/modelsphere.dev/v1/example"
	srv, handler, admin, _ := pluginRegistryServer(t, entry)
	for _, token := range []string{"", admin} {
		request := httptest.NewRequest("GET", "/oapis/modelsphere.dev/v1/example/dist/embed.js", nil)
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		request.Header.Set("Cookie", "test=credential")
		request.Header.Set("X-Remote-User", "spoofed")
		request.Header.Set("X-Remote-Group", "system:masters")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusOK || response.Body.String() != "/dist/embed.js" {
			t.Fatalf("asset: %d %s", response.Code, response.Body.String())
		}
	}
	if srv.pluginIndex()[0].Backend != nil {
		t.Fatal("static-only plugin must not require a backend capability")
	}
}
