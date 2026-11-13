package iam

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

// ErrAuth is returned for every credential failure, without distinguishing
// unknown-user from wrong-password -- the caller maps it to a single
// invalid_grant, so an attacker learns nothing about which users exist.
var ErrAuth = errors.New("invalid username or password")

type authFailure struct {
	reason string
}

func (e *authFailure) Error() string { return ErrAuth.Error() }
func (e *authFailure) Unwrap() error { return ErrAuth }

func newAuthFailure(reason string) error { return &authFailure{reason: reason} }

func AuthFailureReason(err error) string {
	var failure *authFailure
	if errors.As(err, &failure) {
		return failure.reason
	}
	return "authentication failed"
}

// Authenticator turns a username and password into a token, verifying against
// the User CRD and stamping the last-login time.
type Authenticator struct {
	store  *Store
	signer *Signer
	log    *slog.Logger
}

func NewAuthenticator(store *Store, signer *Signer, log *slog.Logger) *Authenticator {
	return &Authenticator{store: store, signer: signer, log: log}
}

func (a *Authenticator) Login(ctx context.Context, username, password string) (*Token, error) {
	if username == "" || password == "" {
		return nil, newAuthFailure("username or password missing")
	}
	u, err := a.store.GetUser(ctx, username)
	if apierrors.IsNotFound(err) {
		return nil, newAuthFailure("user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("get user: %w", err)
	}
	if u.Status.State != "" && u.Status.State != UserActive {
		return nil, newAuthFailure("user is not active")
	}
	if u.Spec.EncryptedPassword == "" || !VerifyPassword(password, u.Spec.EncryptedPassword) {
		return nil, newAuthFailure("invalid password")
	}
	tok, err := a.signer.Mint(u)
	if err != nil {
		return nil, err
	}
	// Best-effort: a stale last-login must not fail an otherwise valid login.
	if err := a.store.UpdateLastLogin(ctx, username); err != nil {
		a.log.Warn("update last login", "user", username, "err", err)
	}
	return tok, nil
}
