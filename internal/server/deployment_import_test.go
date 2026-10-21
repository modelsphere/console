package server

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/modelsphere/console/internal/cluster"
	"github.com/modelsphere/console/internal/config"
	"github.com/modelsphere/console/internal/iam"
	"gopkg.in/yaml.v3"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	k8stesting "k8s.io/client-go/testing"
)

var importSecretsGVR = schema.GroupVersionResource{Version: "v1", Resource: "secrets"}
var importMapsGVR = schema.GroupVersionResource{Version: "v1", Resource: "configmaps"}
var importTestHash = "sha256:" + strings.Repeat("a", 64)

const importSelection = `{"namespace":"models","release":"model","catalog":"catalog","model":"llm","variant":"gpu","version":"2026.1"}`

func serverImportSecret(t *testing.T) *unstructured.Unstructured {
	t.Helper()
	payload := map[string]any{"name": "model", "namespace": "models", "version": 3, "info": map[string]any{"status": "deployed"}, "chart": map[string]any{"metadata": map[string]any{"name": "inference", "version": "1.2.3"}}, "config": map[string]any{"serviceId": "original", "replicaCount": 2, "extraArgs": []any{"--original"}}}
	raw, _ := json.Marshal(payload)
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	_, _ = zw.Write(raw)
	_ = zw.Close()
	return &unstructured.Unstructured{Object: map[string]any{"apiVersion": "v1", "kind": "Secret", "type": "helm.sh/release.v1", "metadata": map[string]any{"name": "sh.helm.release.v1.model.v3", "namespace": "models", "uid": "helm-uid", "resourceVersion": "17", "labels": map[string]any{"owner": "helm", "name": "model", "version": "3", "status": "deployed"}}, "data": map[string]any{"release": base64.StdEncoding.EncodeToString([]byte(base64.StdEncoding.EncodeToString(buf.Bytes())))}}}
}

func importPlanFixture() map[string]any {
	return map[string]any{"apiVersion": "plan.swiss/v1", "release": map[string]any{"name": "model", "namespace": "models"}, "source": map[string]any{"catalogName": "catalog", "catalog": "https://catalog.example", "ref": "current-sha", "model": "llm", "variant": "gpu", "version": "2026.1"}, "chart": map[string]any{"name": "inference", "version": "1.2.3", "repo": "https://charts.example"}, "engine": "vllm", "profile": "site", "layers": map[string]any{"catalog": map[string]any{"image": "catalog-image"}, "form": map[string]any{"serviceId": "original", "replicaCount": float64(2), "extraArgs": []any{"--original"}}}, "helmfile": "releases:\n- name: model\n", "hash": importTestHash}
}

func newImportServer(t *testing.T, upstream http.HandlerFunc) (*Server, *dynamicfake.FakeDynamicClient) {
	t.Helper()
	remote := httptest.NewServer(upstream)
	t.Cleanup(remote.Close)
	cfg := &config.Config{Server: config.Server{Auth: config.Auth{Disabled: true}}, Backends: []config.Backend{{Name: "swiss", Prefix: "/api/deploy", URL: remote.URL + "/api"}}, DeploymentImports: config.DeploymentImports{Enabled: true, Namespaces: []string{"models"}}}
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{importSecretsGVR: "SecretList", importMapsGVR: "ConfigMapList", iam.RolesGVR: "IAMRoleList", iam.RoleBindingsGVR: "IAMRoleBindingList"}, serverImportSecret(t))
	log := slog.New(slog.DiscardHandler)
	srv := New(cfg, cluster.NewKubeFrom(dyn), log, "test")
	store := iam.NewStore(dyn)
	srv.SetIAM(store, nil, iam.NewAuthenticator(store, nil, log), iam.NewAuthorizer(store))
	return srv, dyn
}

func successImportPlan(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, importPlanFixture())
}

func commitImportBody(t *testing.T, preview *httptest.ResponseRecorder) string {
	t.Helper()
	var p deploymentImportPreview
	if err := json.Unmarshal(preview.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	var req map[string]any
	_ = json.Unmarshal([]byte(importSelection), &req)
	req["expectedRevision"] = p.Revision
	req["expectedSecretUID"] = p.SecretUID
	req["expectedResourceVersion"] = p.ResourceVersion
	req["expectedPlanHash"] = p.Plan["hash"]
	raw, _ := json.Marshal(req)
	return string(raw)
}

func assertNoImportWrites(t *testing.T, dyn *dynamicfake.FakeDynamicClient) {
	t.Helper()
	for _, a := range dyn.Actions() {
		if a.GetVerb() == "create" || a.GetVerb() == "update" || a.GetVerb() == "patch" || a.GetVerb() == "delete" {
			t.Fatalf("unexpected write: %#v", a)
		}
	}
}

func TestDeploymentImportPreservesValuesAndCompatibleWorkspace(t *testing.T) {
	calls := 0
	srv, dyn := newImportServer(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "POST" || r.URL.Path != "/api/plans" {
			t.Errorf("upstream %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer backend-key" {
			t.Errorf("backend credential was not forwarded")
		}
		if r.Header.Get("Cookie") != "" || r.Header.Get("X-Remote-User") != "admin" || r.Header.Get("X-Remote-Group") != "system:masters" {
			t.Errorf("headers = %v", r.Header)
		}
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req["release"] != "model" || req["namespace"] != "models" || req["chartVersion"] != "1.2.3" || req["version"] != "2026.1" {
			t.Errorf("composition identity = %v", req)
		}
		values, _ := req["overrides"].(map[string]any)
		if values["serviceId"] != "original" || values["replicaCount"] != float64(2) {
			t.Errorf("overrides = %v", values)
		}
		successImportPlan(w, r)
	})
	t.Setenv("SWISS_IMPORT_TEST_KEY", "backend-key")
	srv.cfg.Backends[0].APIKeyEnv = "SWISS_IMPORT_TEST_KEY"
	original := srv.backendTargets()["swiss"]
	srv.targets["swiss"] = func(ctx context.Context) (*backendTarget, error) {
		target, err := original(ctx)
		if target.key != "Bearer backend-key" {
			t.Errorf("credential not loaded")
		}
		return target, err
	}
	h := srv.Handler()
	preview := do(h, "POST", "/api/deployment-imports/preview", "caller", importSelection)
	if preview.Code != 200 {
		t.Fatalf("preview %d %s", preview.Code, preview.Body.String())
	}
	if preview.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("preview cacheable")
	}
	var p deploymentImportPreview
	_ = json.Unmarshal(preview.Body.Bytes(), &p)
	if p.Revision != 3 || p.SecretUID != "helm-uid" || strings.Join(p.Warnings, ",") != "new_management_baseline,values_require_upgrade_review,import_records_only" {
		t.Fatalf("preview = %+v", p)
	}
	assertNoImportWrites(t, dyn)
	commit := do(h, "POST", "/api/deployment-imports", "caller", commitImportBody(t, preview))
	if commit.Code != 201 {
		t.Fatalf("commit %d %s", commit.Code, commit.Body.String())
	}
	if calls != 2 {
		t.Fatalf("compositions = %d", calls)
	}
	cm, err := dyn.Resource(importMapsGVR).Namespace("models").Get(t.Context(), "swiss-plan-model", metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	files, _, _ := unstructured.NestedStringMap(cm.Object, "data")
	var meta map[string]any
	if err := yaml.Unmarshal([]byte(files["plan.yaml"]), &meta); err != nil {
		t.Fatal(err)
	}
	if meta["apiVersion"] != "plan.swiss/v1" || meta["hash"] != importTestHash || meta["layers"] != nil || meta["helmfile"] != nil {
		t.Fatalf("metadata = %v", meta)
	}
	var form map[string]any
	_ = yaml.Unmarshal([]byte(files["form.yaml"]), &form)
	if form["serviceId"] != "original" || form["replicaCount"] != 2 || files["helmfile.yaml"] == "" || files["catalog.yaml"] == "" {
		t.Fatalf("workspace = %v", files)
	}
	var status map[string]any
	_ = yaml.Unmarshal([]byte(files["status.yaml"]), &status)
	if status["phase"] != "applied" || status["action"] != "import" || status["revision"] != 3 {
		t.Fatalf("status = %v", status)
	}
	if cm.GetLabels()["app.kubernetes.io/managed-by"] != "swiss" || cm.GetAnnotations()["console.modelsphere.io/imported-source-uid"] != "helm-uid" || cm.GetAnnotations()["console.modelsphere.io/imported-by"] != "admin" {
		t.Fatalf("annotations = %v", cm.GetAnnotations())
	}
	for _, a := range dyn.Actions() {
		if a.GetVerb() == "update" || a.GetVerb() == "patch" || a.GetResource().Resource == "secrets" && a.GetVerb() != "list" {
			t.Fatalf("unexpected mutation: %#v", a)
		}
	}
	if got := do(h, "POST", "/api/deployment-imports", "", commitImportBody(t, preview)); got.Code != 409 {
		t.Fatalf("duplicate %d %s", got.Code, got.Body.String())
	}
}

func TestDeploymentImportOptionsAvoidClusterReads(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		srv, dyn := newImportServer(t, successImportPlan)
		srv.cfg.DeploymentImports.Enabled = enabled
		rec := do(srv.Handler(), "GET", "/api/deployment-imports", "", "")
		var options struct {
			Enabled    bool     `json:"enabled"`
			Namespaces []string `json:"namespaces"`
		}
		if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &options) != nil || options.Enabled != enabled {
			t.Fatalf("options %d %s", rec.Code, rec.Body.String())
		}
		want := 0
		if enabled {
			want = 1
		}
		if len(options.Namespaces) != want || options.Namespaces == nil || len(dyn.Actions()) != 0 {
			t.Fatalf("options=%+v actions=%v", options, dyn.Actions())
		}
	}
}

func TestDeploymentImportRejectsBeforeClusterReads(t *testing.T) {
	for _, tt := range []struct {
		name, body string
		disabled   bool
		want       int
	}{
		{"disabled", importSelection, true, 404},
		{"namespace", strings.ReplaceAll(importSelection, "models", "other"), false, 403},
		{"invalid namespace", strings.Replace(importSelection, "models", "*", 1), false, 400},
		{"invalid release", strings.Replace(importSelection, `"release":"model"`, `"release":"bad/name"`, 1), false, 400},
		{"trailing JSON", importSelection + `{}`, false, 400},
		{"oversized", `{"model":"` + strings.Repeat("x", maxImportRequestBytes) + `"}`, false, 400},
	} {
		t.Run(tt.name, func(t *testing.T) {
			srv, dyn := newImportServer(t, successImportPlan)
			srv.cfg.DeploymentImports.Enabled = !tt.disabled
			rec := do(srv.Handler(), "POST", "/api/deployment-imports/preview", "", tt.body)
			if rec.Code != tt.want {
				t.Fatalf("got %d %s", rec.Code, rec.Body.String())
			}
			if len(dyn.Actions()) != 0 {
				t.Fatalf("cluster read before validation: %v", dyn.Actions())
			}
		})
	}
}

func TestDeploymentImportRejectsRecompositionAndSecretChanges(t *testing.T) {
	for _, change := range []string{"hash", "uid", "resourceVersion", "revision", "during compose"} {
		t.Run(change, func(t *testing.T) {
			calls := 0
			var dyn *dynamicfake.FakeDynamicClient
			srv, client := newImportServer(t, func(w http.ResponseWriter, r *http.Request) {
				calls++
				p := importPlanFixture()
				if calls > 1 && change == "hash" {
					p["hash"] = "sha256:" + strings.Repeat("b", 64)
				}
				if calls > 1 && change == "during compose" {
					obj, _ := dyn.Tracker().Get(importSecretsGVR, "models", "sh.helm.release.v1.model.v3")
					secret := obj.(*unstructured.Unstructured)
					secret.SetResourceVersion("18")
					_ = dyn.Tracker().Update(importSecretsGVR, secret, "models")
				}
				writeJSON(w, 200, p)
			})
			dyn = client
			h := srv.Handler()
			preview := do(h, "POST", "/api/deployment-imports/preview", "", importSelection)
			if preview.Code != 200 {
				t.Fatal(preview.Body.String())
			}
			body := commitImportBody(t, preview)
			switch change {
			case "uid":
				body = strings.Replace(body, "helm-uid", "other", 1)
			case "resourceVersion":
				body = strings.Replace(body, `"expectedResourceVersion":"17"`, `"expectedResourceVersion":"18"`, 1)
			case "revision":
				body = strings.Replace(body, `"expectedRevision":3`, `"expectedRevision":4`, 1)
			}
			rec := do(h, "POST", "/api/deployment-imports", "", body)
			if rec.Code != 409 {
				t.Fatalf("got %d %s", rec.Code, rec.Body.String())
			}
			assertNoImportWrites(t, dyn)
		})
	}
}

func TestDeploymentImportSanitizesUpstreamAndRejectsMismatches(t *testing.T) {
	for _, kind := range []string{"error", "redirect", "chart", "chart version", "apiVersion", "source", "oversized", "layer"} {
		t.Run(kind, func(t *testing.T) {
			srv, dyn := newImportServer(t, func(w http.ResponseWriter, r *http.Request) {
				p := importPlanFixture()
				switch kind {
				case "error":
					http.Error(w, "secret backend values", 500)
					return
				case "redirect":
					w.Header().Set("Location", "http://127.0.0.1:1/credential-leak")
					http.Error(w, "secret backend values", 302)
					return
				case "chart":
					p["chart"].(map[string]any)["name"] = "other"
				case "chart version":
					p["chart"].(map[string]any)["version"] = "2.0"
				case "apiVersion":
					p["apiVersion"] = "plan.swiss/v2"
				case "source":
					p["source"].(map[string]any)["model"] = "other"
				case "oversized":
					_, _ = w.Write([]byte(strings.Repeat("x", maxImportPlanBytes+1)))
					return
				case "layer":
					p["layers"].(map[string]any)["plan"] = map[string]any{}
				}
				writeJSON(w, 200, p)
			})
			rec := do(srv.Handler(), "POST", "/api/deployment-imports/preview", "", importSelection)
			if rec.Code != 502 || strings.Contains(rec.Body.String(), "secret backend values") {
				t.Fatalf("got %d %s", rec.Code, rec.Body.String())
			}
			assertNoImportWrites(t, dyn)
		})
	}
}

func TestDeploymentImportCreateRaceConflict(t *testing.T) {
	srv, dyn := newImportServer(t, successImportPlan)
	h := srv.Handler()
	preview := do(h, "POST", "/api/deployment-imports/preview", "", importSelection)
	dyn.PrependReactor("create", "configmaps", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewAlreadyExists(schema.GroupResource{Resource: "configmaps"}, "swiss-plan-model")
	})
	rec := do(h, "POST", "/api/deployment-imports", "", commitImportBody(t, preview))
	if rec.Code != 409 {
		t.Fatalf("got %d %s", rec.Code, rec.Body.String())
	}
}

func TestDeploymentImportAuthorizationIsSeparateFromUI(t *testing.T) {
	for _, grant := range []string{"none", "get only", "wrong release", "all"} {
		t.Run(grant, func(t *testing.T) {
			srv, dyn := newImportServer(t, successImportPlan)
			rules := []any{}
			if grant != "none" {
				verbs := []any{"get"}
				if grant != "get only" {
					verbs = append(verbs, "create")
				}
				rules = append(rules, map[string]any{"apiGroups": []any{iam.Group}, "resources": []any{"backends"}, "resourceNames": []any{"swiss"}, "verbs": verbs})
			}
			if grant == "wrong release" || grant == "all" {
				name := "models/model"
				if grant == "wrong release" {
					name = "models/other"
				}
				rules = append(rules, map[string]any{"apiGroups": []any{iam.Group}, "resources": []any{"deploymentimports"}, "resourceNames": []any{name}, "verbs": []any{"create"}})
			}
			role := globalObj("IAMRole", "importer", iam.ScopePlatform, iam.ScopeGlobal, map[string]any{"uiPermissions": []any{"deployments.import"}, "rules": rules})
			binding := globalBinding("importer-admin", "importer", iam.ScopePlatform, iam.ScopeGlobal)
			if err := dyn.Tracker().Add(role); err != nil {
				t.Fatal(err)
			}
			if err := dyn.Tracker().Add(binding); err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest("POST", "/api/deployment-imports/preview", strings.NewReader(importSelection))
			req = req.WithContext(withIdentity(req.Context(), &iam.Identity{Name: "admin"}))
			rec := httptest.NewRecorder()
			srv.handleDeploymentImportPreview(rec, req)
			want := 403
			if grant == "all" {
				want = 200
			}
			if rec.Code != want {
				t.Fatalf("got %d want %d %s", rec.Code, want, rec.Body.String())
			}
			if grant != "all" {
				for _, a := range dyn.Actions() {
					if a.GetResource() == importSecretsGVR || a.GetResource() == importMapsGVR {
						t.Fatalf("unauthorized cluster access: %#v", a)
					}
				}
			}
		})
	}
}

func TestDeploymentImportAuthenticationAndReset(t *testing.T) {
	srv := testServerWithConfig(t, &config.Config{DeploymentImports: config.DeploymentImports{Enabled: true, Namespaces: []string{"models"}}})
	h := srv.Handler()
	if rec := do(h, "POST", "/api/deployment-imports/preview", "", importSelection); rec.Code != 401 {
		t.Fatalf("anonymous %d", rec.Code)
	}
	setRequirePasswordReset(t, srv, true)
	token := login(t, h, "admin", "admin-pw")
	if rec := do(h, "POST", "/api/deployment-imports/preview", token, importSelection); rec.Code != 403 {
		t.Fatalf("reset %d", rec.Code)
	}
}

func TestDeploymentImportRejectsLLMServiceOwnership(t *testing.T) {
	for _, mode := range []string{"existing external", "lookup forbidden", "appears during compose"} {
		t.Run(mode, func(t *testing.T) {
			var dyn *dynamicfake.FakeDynamicClient
			gvr := schema.GroupVersionResource{Group: "serving.modelsphere.dev", Version: "v1alpha1", Resource: "llmservices"}
			owner := &unstructured.Unstructured{Object: map[string]any{"apiVersion": "serving.modelsphere.dev/v1alpha1", "kind": "LLMService", "metadata": map[string]any{"name": "model", "namespace": "models"}}}
			calls := 0
			srv, client := newImportServer(t, func(w http.ResponseWriter, r *http.Request) {
				calls++
				if calls == 2 && mode == "appears during compose" {
					if err := dyn.Tracker().Add(owner); err != nil {
						t.Error(err)
					}
				}
				successImportPlan(w, r)
			})
			dyn = client
			if mode == "existing external" {
				if err := dyn.Tracker().Add(owner); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "lookup forbidden" {
				dyn.PrependReactor("get", "llmservices", func(k8stesting.Action) (bool, runtime.Object, error) {
					return true, nil, apierrors.NewForbidden(gvr.GroupResource(), "model", errors.New("backend credentials must not leak"))
				})
			}
			h := srv.Handler()
			rec := do(h, "POST", "/api/deployment-imports/preview", "", importSelection)
			if mode == "appears during compose" {
				if rec.Code != 200 {
					t.Fatal(rec.Body.String())
				}
				rec = do(h, "POST", "/api/deployment-imports", "", commitImportBody(t, rec))
			}
			want := 409
			if mode == "lookup forbidden" {
				want = 502
			}
			if rec.Code != want || strings.Contains(rec.Body.String(), "credentials") {
				t.Fatalf("got %d %s", rec.Code, rec.Body.String())
			}
			assertNoImportWrites(t, dyn)
		})
	}
}

func TestImportedWorkspaceRejectsConfigMapOverflow(t *testing.T) {
	p := importPlanFixture()
	p["helmfile"] = strings.Repeat("x", 900<<10)
	if _, err := importedPlanFiles(p, 3, time.Now()); err == nil {
		t.Fatal("oversized ConfigMap accepted")
	}
}
