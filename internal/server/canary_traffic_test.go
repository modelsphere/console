package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/modelsphere/console/internal/config"
)

func TestCanaryTrafficRequiresBackendUpdateAndWritePermission(t *testing.T) {
	for _, tc := range []struct {
		name      string
		verbs, ui []string
		want      int
	}{
		{"reader", []string{"get"}, nil, 403},
		{"backend update without UI write", []string{"get", "update"}, nil, 403},
		{"UI write without backend update", []string{"get"}, []string{"canary.write"}, 403},
		{"writer", []string{"get", "update"}, []string{"canary.write"}, 202},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Method != "PATCH" || r.URL.Path != "/api/canary/experiments/exp/traffic" {
					t.Error("wrong upstream request", r.Method, r.URL.Path)
				}
				w.WriteHeader(202)
			}))
			defer up.Close()
			h := testServerWithConfig(t, &config.Config{Backends: []config.Backend{{Name: "canary", Prefix: "/api/canary", URL: up.URL + "/api/canary"}}}).Handler()
			admin := login(t, h, "admin", "admin-pw")
			body, _ := json.Marshal(map[string]any{"name": "traffic", "uiPermissions": tc.ui, "rules": []map[string]any{{"verbs": tc.verbs, "apiGroups": []string{"iam.theriseunion.io"}, "resources": []string{"backends"}, "resourceNames": []string{"canary"}}}})
			if r := do(h, "POST", "/api/iam/roles", admin, string(body)); r.Code != 201 {
				t.Fatal(r.Code, r.Body.String())
			}
			if r := do(h, "POST", "/api/iam/rolebindings", admin, `{"name":"traffic","role":"traffic","subjects":[{"kind":"User","name":"bob"}]}`); r.Code != 201 {
				t.Fatal(r.Code, r.Body.String())
			}
			bob := login(t, h, "bob", "bob-pw")
			r := do(h, "PATCH", "/api/canary/experiments/exp/traffic", bob, `{"production":90,"canary":10,"expectedGeneration":2}`)
			if r.Code != tc.want {
				t.Fatal(r.Code, r.Body.String())
			}
			if tc.want == 403 && calls.Load() != 0 {
				t.Fatal("unauthorized upstream request")
			}
		})
	}
}
