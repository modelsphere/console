package server

import (
	"net/http"
	"slices"

	"github.com/modelsphere/console/internal/iam"
)

type backendCapability struct {
	Configured bool `json:"configured"`
	CanRead    bool `json:"canRead"`
	CanWrite   bool `json:"canWrite"`
}

func (s *Server) handleCapabilities(w http.ResponseWriter, r *http.Request) {
	backends := s.cfg.ConfiguredBackends()
	capabilities := make(map[string]backendCapability, len(backends))
	identity := identityFrom(r.Context())
	permissions, err := s.authz.PermissionsFor(r.Context(), identity)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, backend := range backends {
		capability := backendCapability{Configured: s.backendTargets()[backend.Name] != nil}
		if capability.Configured {
			capability.CanRead, err = s.authz.Authorize(r.Context(), identity, iam.Attributes{Verb: "get", APIGroup: iam.Group, Resource: backendResource, Name: backend.Name})
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			canCreate, createErr := s.authz.Authorize(r.Context(), identity, iam.Attributes{Verb: "create", APIGroup: iam.Group, Resource: backendResource, Name: backend.Name})
			if createErr != nil {
				writeError(w, http.StatusInternalServerError, createErr.Error())
				return
			}
			canUpdate, updateErr := s.authz.Authorize(r.Context(), identity, iam.Attributes{Verb: "update", APIGroup: iam.Group, Resource: backendResource, Name: backend.Name})
			if updateErr != nil {
				writeError(w, http.StatusInternalServerError, updateErr.Error())
				return
			}
			capability.CanWrite = canCreate && canUpdate && (backend.WritePermission == "" || slices.Contains(permissions, "*") || slices.Contains(permissions, backend.WritePermission))
		}
		capabilities[backend.Name] = capability
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, capabilities)
}
