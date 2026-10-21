package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"maps"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/modelsphere/console/internal/cluster"
	"gopkg.in/yaml.v3"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/util/validation"
)

const importTimeout = 45 * time.Second
const maxImportRequestBytes = 16 << 10
const maxImportPlanBytes = 2 << 20

var importHashRE = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
var importLayers = []string{"defaults", "catalog", "site", "derived", "form", "edit"}

type deploymentImportRequest struct {
	Namespace               string `json:"namespace"`
	Release                 string `json:"release"`
	Catalog                 string `json:"catalog"`
	Model                   string `json:"model"`
	Variant                 string `json:"variant"`
	Version                 string `json:"version,omitempty"`
	ExpectedRevision        int    `json:"expectedRevision,omitempty"`
	ExpectedSecretUID       string `json:"expectedSecretUID,omitempty"`
	ExpectedResourceVersion string `json:"expectedResourceVersion,omitempty"`
	ExpectedPlanHash        string `json:"expectedPlanHash,omitempty"`
}

type deploymentImportPreview struct {
	Plan            map[string]any `json:"plan"`
	Revision        int            `json:"revision"`
	Chart           string         `json:"chart"`
	SecretUID       string         `json:"secretUID"`
	ResourceVersion string         `json:"resourceVersion"`
	Warnings        []string       `json:"warnings"`
}

func (s *Server) mountDeploymentImports(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/deployment-imports", s.handleDeploymentImportOptions)
	mux.HandleFunc("POST /api/deployment-imports/preview", s.handleDeploymentImportPreview)
	mux.HandleFunc("POST /api/deployment-imports", s.handleDeploymentImport)
}

func (s *Server) handleDeploymentImportOptions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	d := s.cfg.DeploymentImports.WithDefaults()
	if !s.authorize(w, r, "get", backendResource, d.Backend) {
		return
	}
	namespaces := []string{}
	if d.Enabled {
		namespaces = append(namespaces, d.Namespaces...)
	}
	writeJSON(w, http.StatusOK, map[string]any{"enabled": d.Enabled, "namespaces": namespaces})
}

func (s *Server) deploymentImportInput(w http.ResponseWriter, r *http.Request, commit bool) (deploymentImportRequest, bool) {
	w.Header().Set("Cache-Control", "no-store")
	var req deploymentImportRequest
	d := s.cfg.DeploymentImports.WithDefaults()
	if !d.Enabled {
		writeError(w, http.StatusNotFound, "deployment imports are disabled")
		return req, false
	}
	_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(10 * time.Second))
	defer http.NewResponseController(w).SetReadDeadline(time.Time{})
	r.Body = http.MaxBytesReader(w, r.Body, maxImportRequestBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid import request")
		return req, false
	}
	if dec.Decode(new(any)) != io.EOF {
		writeError(w, http.StatusBadRequest, "one import request is required")
		return req, false
	}
	if len(validation.IsDNS1123Label(req.Namespace)) != 0 || req.Namespace == "" || len(req.Release) > 53 || req.Release == "" || len(validation.IsDNS1123Subdomain(req.Release)) != 0 || len(validation.IsDNS1123Subdomain(d.PlanConfigMapPrefix+req.Release)) != 0 {
		writeError(w, http.StatusBadRequest, "namespace and release must be valid explicit Kubernetes names")
		return req, false
	}
	if !slices.Contains(d.Namespaces, req.Namespace) {
		writeError(w, http.StatusForbidden, "namespace is not enabled for deployment imports")
		return req, false
	}
	for _, v := range []string{req.Catalog, req.Model, req.Variant} {
		if v == "" || len(v) > 256 || strings.TrimSpace(v) != v {
			writeError(w, http.StatusBadRequest, "catalog, model and variant are required")
			return req, false
		}
	}
	if len(req.Version) > 256 {
		writeError(w, http.StatusBadRequest, "model version is too long")
		return req, false
	}
	if commit && (req.ExpectedRevision <= 0 || req.ExpectedSecretUID == "" || len(req.ExpectedSecretUID) > 256 || req.ExpectedResourceVersion == "" || len(req.ExpectedResourceVersion) > 256 || !importHashRE.MatchString(req.ExpectedPlanHash)) {
		writeError(w, http.StatusBadRequest, "preview revision, Secret identity and plan hash are required")
		return req, false
	}
	if !s.authorize(w, r, "get", backendResource, d.Backend) || !s.authorize(w, r, "create", backendResource, d.Backend) || !s.authorize(w, r, "create", "deploymentimports", req.Namespace+"/"+req.Release) || !s.haveKube(w) {
		return req, false
	}
	return req, true
}

func (s *Server) handleDeploymentImportPreview(w http.ResponseWriter, r *http.Request) {
	req, ok := s.deploymentImportInput(w, r, false)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), importTimeout)
	defer cancel()
	p, _, ok := s.previewDeploymentImport(ctx, w, r, req)
	if ok {
		writeJSON(w, http.StatusOK, p)
	}
}

func (s *Server) previewDeploymentImport(ctx context.Context, w http.ResponseWriter, r *http.Request, req deploymentImportRequest) (*deploymentImportPreview, *cluster.HelmImportRelease, bool) {
	d := s.cfg.DeploymentImports.WithDefaults()
	if !s.checkImportOwner(ctx, w, req.Namespace, req.Release) {
		return nil, nil, false
	}
	_, err := s.kube.ConfigMap(ctx, req.Namespace, d.PlanConfigMapPrefix+req.Release)
	if err == nil {
		writeError(w, http.StatusConflict, "a management record already exists for this release")
		return nil, nil, false
	}
	if !apierrors.IsNotFound(err) {
		writeError(w, http.StatusBadGateway, "cannot check the existing management record")
		return nil, nil, false
	}
	hr, err := s.kube.HelmImportRelease(ctx, req.Namespace, req.Release)
	if err != nil {
		writeImportReadError(w, err)
		return nil, nil, false
	}
	if req.ExpectedRevision != 0 && !matchesImportSecret(req, hr) {
		writeError(w, http.StatusConflict, "Helm release changed; preview again")
		return nil, nil, false
	}
	plan, err := s.composeImportedPlan(ctx, r, req, hr)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return nil, nil, false
	}
	warnings := []string{
		"new_management_baseline",
		"values_require_upgrade_review",
		"import_records_only",
	}
	if items, ok := plan["warnings"].([]any); ok {
		for _, item := range items {
			if text, ok := item.(string); ok {
				warnings = append(warnings, text)
			}
		}
	}
	return &deploymentImportPreview{Plan: plan, Revision: hr.Version, Chart: hr.Chart.Metadata.Name + "-" + hr.Chart.Metadata.Version, SecretUID: hr.SecretUID, ResourceVersion: hr.ResourceVersion, Warnings: warnings}, hr, true
}

func matchesImportSecret(req deploymentImportRequest, hr *cluster.HelmImportRelease) bool {
	return req.ExpectedRevision == hr.Version && req.ExpectedSecretUID == hr.SecretUID && req.ExpectedResourceVersion == hr.ResourceVersion
}

func (s *Server) composeImportedPlan(ctx context.Context, r *http.Request, req deploymentImportRequest, hr *cluster.HelmImportRelease) (map[string]any, error) {
	fail := func(message string) (map[string]any, error) { return nil, errors.New(message) }
	name := s.cfg.DeploymentImports.WithDefaults().Backend
	resolve := s.backendTargets()[name]
	if resolve == nil {
		return fail("configured Swiss backend is unavailable")
	}
	target, err := resolve(ctx)
	if err != nil {
		return fail("configured Swiss backend is unavailable")
	}
	body, err := json.Marshal(map[string]any{"namespace": req.Namespace, "release": req.Release, "catalog": req.Catalog, "model": req.Model, "variant": req.Variant, "version": req.Version, "chartVersion": hr.Chart.Metadata.Version, "overrides": hr.Config})
	if err != nil || len(body) > maxImportPlanBytes {
		return fail("Helm supplied values exceed import limits")
	}
	u := target.url
	u.Path = strings.TrimSuffix(u.Path, "/") + "/plans"
	u.RawPath, u.RawQuery, u.Fragment = "", "", ""
	upstream, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return fail("configured Swiss backend is unavailable")
	}
	upstream.Header.Set("Content-Type", "application/json")
	if id := identityFrom(r.Context()); id != nil {
		upstream.Header.Set("X-Remote-User", id.Name)
		for _, group := range id.Groups {
			upstream.Header.Add("X-Remote-Group", group)
		}
	}
	if token := bearerToken(r); token != "" {
		upstream.Header.Set("Authorization", "Bearer "+token)
	}
	if target.key != "" {
		upstream.Header.Set(target.header, target.key)
	}
	client := &http.Client{Timeout: 35 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(upstream)
	if err != nil {
		return fail("Swiss plan composition is unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fail("Swiss refused plan composition; verify the selected model, chart version and supplied values")
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxImportPlanBytes+1))
	if err != nil || len(raw) > maxImportPlanBytes {
		return fail("Swiss plan response exceeds import limits or is unreadable")
	}
	var p map[string]any
	if json.Unmarshal(raw, &p) != nil {
		return fail("Swiss returned an invalid plan")
	}
	release, _ := p["release"].(map[string]any)
	chart, _ := p["chart"].(map[string]any)
	source, _ := p["source"].(map[string]any)
	hash, _ := p["hash"].(string)
	if p["apiVersion"] != "plan.swiss/v1" || release["name"] != req.Release || release["namespace"] != req.Namespace || !importHashRE.MatchString(hash) {
		return fail("Swiss returned an incompatible plan or release identity")
	}
	if chart["name"] != hr.Chart.Metadata.Name || chart["version"] != hr.Chart.Metadata.Version {
		return fail("selected model chart does not match the existing Helm chart and exact version")
	}
	if source["model"] != req.Model || source["variant"] != req.Variant || source["catalogName"] != req.Catalog || req.Version != "" && source["version"] != req.Version {
		return fail("Swiss returned a different catalog selection")
	}
	if _, err := importedPlanFiles(p, hr.Version, time.Now()); err != nil {
		return fail("Swiss returned an incompatible or oversized plan workspace")
	}
	return p, nil
}

func (s *Server) handleDeploymentImport(w http.ResponseWriter, r *http.Request) {
	req, ok := s.deploymentImportInput(w, r, true)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), importTimeout)
	defer cancel()
	preview, _, ok := s.previewDeploymentImport(ctx, w, r, req)
	if !ok {
		return
	}
	if preview.Plan["hash"] != req.ExpectedPlanHash {
		writeError(w, http.StatusConflict, "composed plan changed; preview again")
		return
	}
	now := time.Now().UTC()
	files, err := importedPlanFiles(preview.Plan, preview.Revision, now)
	if err != nil {
		writeError(w, http.StatusBadGateway, "cannot encode imported plan workspace")
		return
	}
	// Composition may take time; narrow the cross-resource race with one final read.
	latest, err := s.kube.HelmImportRelease(ctx, req.Namespace, req.Release)
	if err != nil {
		writeImportReadError(w, err)
		return
	}
	if !matchesImportSecret(req, latest) {
		writeError(w, http.StatusConflict, "Helm release changed; preview again")
		return
	}
	if !s.checkImportOwner(ctx, w, req.Namespace, req.Release) {
		return
	}
	actor := identityFrom(r.Context()).Name
	annotations := map[string]string{
		"console.modelsphere.io/imported-source-uid":      preview.SecretUID,
		"console.modelsphere.io/imported-source-revision": strconv.Itoa(preview.Revision),
		"console.modelsphere.io/imported-by":              actor,
		"console.modelsphere.io/imported-at":              now.Format(time.RFC3339),
	}
	d := s.cfg.DeploymentImports.WithDefaults()
	err = s.kube.CreateImportedPlan(ctx, req.Namespace, d.PlanConfigMapPrefix+req.Release, files, annotations)
	if apierrors.IsAlreadyExists(err) {
		writeError(w, http.StatusConflict, "a management record already exists for this release")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "cannot create imported management record")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"namespace": req.Namespace, "release": req.Release, "revision": preview.Revision, "planHash": req.ExpectedPlanHash})
}

func importedPlanFiles(p map[string]any, revision int, now time.Time) (map[string]string, error) {
	files := map[string]string{}
	layers, ok := p["layers"].(map[string]any)
	if !ok || len(layers) == 0 {
		return nil, errors.New("missing layers")
	}
	for layer, tree := range layers {
		if !slices.Contains(importLayers, layer) {
			return nil, errors.New("unsupported layer")
		}
		if _, ok := tree.(map[string]any); !ok {
			return nil, errors.New("invalid layer")
		}
		doc, err := yaml.Marshal(tree)
		if err != nil {
			return nil, err
		}
		files[layer+".yaml"] = string(doc)
	}
	if helmfile, ok := p["helmfile"].(string); ok && helmfile != "" {
		files["helmfile.yaml"] = helmfile
	}
	meta := maps.Clone(p)
	delete(meta, "layers")
	delete(meta, "helmfile")
	doc, err := yaml.Marshal(meta)
	if err != nil {
		return nil, err
	}
	files["plan.yaml"] = string(doc)
	status, err := yaml.Marshal(map[string]any{"phase": "applied", "action": "import", "revision": revision, "startedAt": now.UTC().Format(time.RFC3339), "updatedAt": now.UTC().Format(time.RFC3339)})
	if err != nil {
		return nil, err
	}
	files["status.yaml"] = string(status)
	size := 0
	for key, value := range files {
		size += len(key) + len(value)
	}
	if size > 900<<10 {
		return nil, errors.New("workspace exceeds ConfigMap size limit")
	}
	return files, nil
}

func (s *Server) checkImportOwner(ctx context.Context, w http.ResponseWriter, namespace, release string) bool {
	exists, err := s.kube.ImportHasLLMService(ctx, namespace, release)
	if err != nil {
		writeError(w, http.StatusBadGateway, "cannot establish absence of an LLMService owner")
		return false
	}
	if exists {
		writeError(w, http.StatusConflict, "an LLMService already owns this release")
		return false
	}
	return true
}

func writeImportReadError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, cluster.ErrHelmNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, cluster.ErrHelmNotDeployed):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, cluster.ErrInvalidHelmRelease):
		writeError(w, http.StatusUnprocessableEntity, err.Error())
	default:
		writeError(w, http.StatusBadGateway, "cannot read Helm release storage")
	}
}
