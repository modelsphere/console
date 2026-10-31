package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/modelsphere/console/internal/config"
)

func TestCanaryCapabilities(t *testing.T) {
	for _, tc := range []struct {
		name     string
		backend  bool
		admin    bool
		disabled bool
		verbs    []string
		ui       []string
		want     backendCapability
	}{
		{name: "absent even for admin", admin: true},
		{name: "configured admin", backend: true, admin: true, want: backendCapability{true, true, true}},
		{name: "auth disabled", backend: true, disabled: true, want: backendCapability{true, true, true}},
		{name: "no permission", backend: true, want: backendCapability{true, false, false}},
		{name: "reader", backend: true, verbs: []string{"get"}, want: backendCapability{true, true, false}},
		{name: "writer", backend: true, verbs: []string{"get", "create", "update"}, ui: []string{"canary.write"}, want: backendCapability{true, true, true}},
		{name: "backend rights without UI write", backend: true, verbs: []string{"get", "create", "update"}, want: backendCapability{true, true, false}},
		{name: "UI write without backend update", backend: true, verbs: []string{"get", "create"}, ui: []string{"canary.write"}, want: backendCapability{true, true, false}},
		{name: "UI write without read", backend: true, verbs: []string{"create", "update"}, ui: []string{"canary.write"}, want: backendCapability{true, false, false}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.WriteHeader(http.StatusServiceUnavailable)
			}))
			defer up.Close()
			cfg := &config.Config{}
			cfg.Server.Auth.Disabled = tc.disabled
			if tc.backend {
				cfg.Backends = []config.Backend{{Name: "canary", Prefix: "/api/canary", URL: up.URL + "/api/canary"}}
			}
			h := testServerWithConfig(t, cfg).Handler()
			admin := login(t, h, "admin", "admin-pw")
			if len(tc.verbs) > 0 || len(tc.ui) > 0 {
				body, _ := json.Marshal(map[string]any{"name": "canary-access", "uiPermissions": tc.ui, "rules": []map[string]any{{"verbs": tc.verbs, "apiGroups": []string{"iam.theriseunion.io"}, "resources": []string{"backends"}, "resourceNames": []string{"canary"}}}})
				if rec := do(h, "POST", "/api/iam/roles", admin, string(body)); rec.Code != http.StatusCreated {
					t.Fatalf("role: %d %s", rec.Code, rec.Body)
				}
				if rec := do(h, "POST", "/api/iam/rolebindings", admin, `{"name":"bob-canary","role":"canary-access","subjects":[{"kind":"User","name":"bob"}]}`); rec.Code != http.StatusCreated {
					t.Fatalf("binding: %d %s", rec.Code, rec.Body)
				}
			}
			token := admin
			if !tc.admin && !tc.disabled {
				token = login(t, h, "bob", "bob-pw")
			}
			for i := 0; i < 2; i++ {
				rec := do(h, "GET", "/api/capabilities", token, "")
				if rec.Code != http.StatusOK {
					t.Fatalf("status: %d %s", rec.Code, rec.Body)
				}
				var got map[string]backendCapability
				if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
					t.Fatal(err)
				}
				if got["canary"] != tc.want {
					t.Fatalf("got %+v want %+v", got, tc.want)
				}
				if rec.Header().Get("Cache-Control") != "no-store" {
					t.Fatal("capabilities must not be cached by HTTP intermediaries")
				}
				if calls.Load() != int32(i) && tc.backend && tc.want.CanRead {
					t.Fatalf("capability lookup contacted upstream: %d", calls.Load())
				}
				if tc.backend && tc.want.CanRead {
					if rec := do(h, "GET", "/api/canary/config", token, ""); rec.Code != http.StatusServiceUnavailable {
						t.Fatalf("upstream failure: %d", rec.Code)
					}
				}
			}
			if tc.backend && !tc.want.CanRead {
				if rec := do(h, "GET", "/api/canary/config", token, ""); rec.Code != http.StatusForbidden {
					t.Fatalf("read should be denied: %d", rec.Code)
				}
			}
			if tc.backend && len(tc.verbs) == 1 {
				if rec := do(h, "POST", "/api/canary/experiments", token, `{}`); rec.Code != http.StatusForbidden {
					t.Fatalf("reader write should be denied: %d", rec.Code)
				}
			}
		})
	}
}

func TestCapabilitiesRequireAuthentication(t *testing.T) {
	if rec := do(testServer(t).Handler(), "GET", "/api/capabilities", "", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestCanaryRequiresItsExpectedProxyPrefix(t *testing.T) {
	cfg := &config.Config{Backends: []config.Backend{{Name: "canary", Prefix: "/api/other", URL: "http://127.0.0.1:1"}}}
	h := testServerWithConfig(t, cfg).Handler()
	token := login(t, h, "admin", "admin-pw")
	rec := do(h, "GET", "/api/capabilities", token, "")
	var got map[string]backendCapability
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["canary"].Configured {
		t.Fatal("UI cannot use a different proxy prefix")
	}
}
