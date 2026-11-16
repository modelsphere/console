package server

import (
	"net/http"
	"slices"
	"strings"

	"github.com/modelsphere/console/internal/iam"
)

type backendCapability struct {
	Configured bool `json:"configured"`
	CanRead    bool `json:"canRead"`
	CanWrite   bool `json:"canWrite"`
}

func (s *Server) handleCapabilities(w http.ResponseWriter, r *http.Request) {
	canary := backendCapability{}
	for _, b := range s.cfg.Backends {
		if b.Name == "canary" && strings.TrimSuffix(b.Prefix, "/") == "/api/canary" {
			_, canary.Configured = s.backendTargets()[b.Name]
			break
		}
	}
	if canary.Configured {
		id := identityFrom(r.Context())
		allowed := func(verb string) (bool, error) {
			return s.authz.Authorize(r.Context(), id, iam.Attributes{Verb: verb, APIGroup: iam.Group, Resource: backendResource, Name: "canary"})
		}
		read, err := allowed("get")
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		canary.CanRead = read
		if read {
			create, err := allowed("create")
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			update, err := allowed("update")
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			permissions, err := s.authz.PermissionsFor(r.Context(), id)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			canary.CanWrite = create && update && (slices.Contains(permissions, "*") || slices.Contains(permissions, "canary.write"))
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]backendCapability{"canary": canary})
}
