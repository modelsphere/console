package server

import (
	"encoding/json"
	"net/http"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/modelsphere/console/internal/iam"
)

// userView is the API shape of a user: the password hash is never serialised.
type userView struct {
	Name          string   `json:"name"`
	Email         string   `json:"email,omitempty"`
	DisplayName   string   `json:"displayName,omitempty"`
	Description   string   `json:"description,omitempty"`
	Groups        []string `json:"groups,omitempty"`
	Lang          string   `json:"lang,omitempty"`
	State         string   `json:"state,omitempty"`
	LastLoginTime *string  `json:"lastLoginTime,omitempty"`
}

func toView(u *iam.User) userView {
	v := userView{
		Name:        u.Name,
		Email:       u.Spec.Email,
		DisplayName: u.Spec.DisplayName,
		Description: u.Spec.Description,
		Groups:      u.Spec.Groups,
		Lang:        u.Spec.Lang,
		State:       string(u.Status.State),
	}
	if u.Status.LastLoginTime != nil {
		t := u.Status.LastLoginTime.Format("2006-01-02T15:04:05Z07:00")
		v.LastLoginTime = &t
	}
	return v
}

// userInput is the create/update body. Password is plaintext and hashed here;
// it is optional on update (empty leaves the existing hash untouched).
type userInput struct {
	Name        string   `json:"name"`
	Email       string   `json:"email"`
	DisplayName string   `json:"displayName"`
	Description string   `json:"description"`
	Groups      []string `json:"groups"`
	Lang        string   `json:"lang"`
	Password    string   `json:"password"`
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	id := identityFrom(r.Context())
	if id == nil {
		writeError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	// The anonymous administrator is not a User CRD, so there is nothing to
	// read and no password state to report. authDisabled tells the shell to
	// skip the login screen and hide the logout it cannot honour.
	if s.cfg.Server.Auth.Disabled {
		writeJSON(w, http.StatusOK, map[string]any{
			"name": id.Name, "groups": id.Groups,
			"isAdmin":              true,
			"permissions":          []string{"*"},
			"requirePasswordReset": false,
			"authDisabled":         true,
		})
		return
	}
	u, err := s.store.GetUser(r.Context(), id.Name)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	permissions, err := s.authz.PermissionsFor(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"name": id.Name, "groups": id.Groups, "email": id.Email,
		"isAdmin":              id.IsSystemMaster(),
		"permissions":          permissions,
		"requirePasswordReset": u.RequiresPasswordReset(),
		"authDisabled":         false,
	})
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r, "list", "users", "") {
		return
	}
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]userView, 0, len(users))
	for i := range users {
		out = append(out, toView(&users[i]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

func (s *Server) handleGetUser(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r, "get", "users", r.PathValue("name")) {
		return
	}
	u, err := s.store.GetUser(r.Context(), r.PathValue("name"))
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, toView(u))
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r, "create", "users", "") {
		return
	}
	var in userInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	u := &iam.User{
		ObjectMeta: metav1.ObjectMeta{Name: in.Name},
		Spec: iam.UserSpec{
			Email: in.Email, DisplayName: in.DisplayName, Description: in.Description,
			Groups: in.Groups, Lang: in.Lang,
		},
	}
	if in.Password != "" {
		if err := iam.ValidateComplexity(in.Password); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		hash, err := iam.HashPassword(in.Password)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "hash password")
			return
		}
		u.Spec.EncryptedPassword = hash
	}
	created, err := s.store.CreateUser(r.Context(), u)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, toView(created))
}

func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !s.authorize(w, r, "update", "users", name) {
		return
	}
	var in userInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	// Read-modify-write so the password hash and metadata survive a partial edit.
	u, err := s.store.GetUser(r.Context(), name)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	u.Spec.Email = in.Email
	u.Spec.DisplayName = in.DisplayName
	u.Spec.Description = in.Description
	u.Spec.Groups = in.Groups
	u.Spec.Lang = in.Lang
	if in.Password != "" {
		if err := iam.ValidateComplexity(in.Password); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		hash, err := iam.HashPassword(in.Password)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "hash password")
			return
		}
		u.Spec.EncryptedPassword = hash
	}
	updated, err := s.store.UpdateUser(r.Context(), u)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, toView(updated))
}

func (s *Server) handleChangeOwnPassword(w http.ResponseWriter, r *http.Request) {
	id := identityFrom(r.Context())
	if id == nil {
		writeError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var in struct {
		OldPassword string `json:"oldPassword"`
		NewPassword string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if in.OldPassword == "" || in.NewPassword == "" {
		writeError(w, http.StatusBadRequest, "当前密码和新密码不能为空")
		return
	}
	u, err := s.store.GetUser(r.Context(), id.Name)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if !iam.VerifyPassword(in.OldPassword, u.Spec.EncryptedPassword) {
		writeError(w, http.StatusUnauthorized, "当前密码错误")
		return
	}
	if iam.VerifyPassword(in.NewPassword, u.Spec.EncryptedPassword) {
		writeError(w, http.StatusBadRequest, "新密码不能与当前密码相同")
		return
	}
	if err := iam.ValidateComplexity(in.NewPassword); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := iam.HashPassword(in.NewPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash password")
		return
	}
	u.Spec.EncryptedPassword = hash
	delete(u.Annotations, iam.RequirePasswordResetAnnotation)
	if _, err := s.store.UpdateUser(r.Context(), u); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r, "delete", "users", r.PathValue("name")) {
		return
	}
	if err := s.store.DeleteUser(r.Context(), r.PathValue("name")); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// authorize checks the caller against the iam RBAC for one action on one
// resource. system:masters passes everything (the seeded admin); anyone else
// needs a role binding that grants it.
func (s *Server) authorize(w http.ResponseWriter, r *http.Request, verb, resource, name string) bool {
	ok, err := s.authz.Authorize(r.Context(), identityFrom(r.Context()),
		iam.Attributes{Verb: verb, APIGroup: iam.Group, Resource: resource, Name: name})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return false
	}
	if !ok {
		writeError(w, http.StatusForbidden, "forbidden")
		return false
	}
	return true
}
