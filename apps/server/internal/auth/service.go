package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

const (
	accessTokenTTL  = 15 * time.Minute
	refreshTokenTTL = 30 * 24 * time.Hour
	defaultRole     = "owner"
)

var (
	ErrEmailAlreadyExists  = errors.New("email already exists")
	ErrInvalidCredentials  = errors.New("invalid credentials")
	ErrInvalidRefreshToken = errors.New("invalid refresh token")
	ErrInvalidAccessToken  = errors.New("invalid access token")
)

type Service struct {
	pool          *pgxpool.Pool
	accessSecret  []byte
	refreshSecret []byte
	now           func() time.Time
}

type RegisterInput struct {
	Email       string
	Password    string
	DisplayName string
}

type LoginInput struct {
	Email    string
	Password string
}

type Session struct {
	AccessToken  string
	RefreshToken string
	User         UserSummary
}

type UserSummary struct {
	ID          string
	Email       string
	DisplayName string
}

type accessClaims struct {
	TokenType string `json:"tokenType"`
	jwt.RegisteredClaims
}

type refreshClaims struct {
	TokenType string `json:"tokenType"`
	jwt.RegisteredClaims
}

func NewService(pool *pgxpool.Pool, accessSecret string, refreshSecret string) *Service {
	return &Service{
		pool:          pool,
		accessSecret:  []byte(accessSecret),
		refreshSecret: []byte(refreshSecret),
		now:           time.Now,
	}
}

func (s *Service) Register(ctx context.Context, input RegisterInput) (Session, error) {
	email := normalizeEmail(input.Email)
	displayName := normalizeDisplayName(input.DisplayName, email)

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return Session{}, fmt.Errorf("hash password: %w", err)
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Session{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var user UserSummary
	if err := tx.QueryRow(
		ctx,
		`INSERT INTO users (email, password_hash, display_name)
		 VALUES ($1, $2, $3)
		 RETURNING id, email, display_name`,
		email,
		string(passwordHash),
		displayName,
	).Scan(&user.ID, &user.Email, &user.DisplayName); err != nil {
		if isUniqueViolation(err) {
			return Session{}, ErrEmailAlreadyExists
		}
		return Session{}, fmt.Errorf("insert user: %w", err)
	}

	workspaceName := buildDefaultWorkspaceName(user.DisplayName)
	var workspaceID string
	if err := tx.QueryRow(
		ctx,
		`INSERT INTO workspaces (name, created_by)
		 VALUES ($1, $2)
		 RETURNING id`,
		workspaceName,
		user.ID,
	).Scan(&workspaceID); err != nil {
		return Session{}, fmt.Errorf("insert workspace: %w", err)
	}

	if _, err := tx.Exec(
		ctx,
		`INSERT INTO workspace_members (workspace_id, user_id, role, invited_by)
		 VALUES ($1, $2, $3, $2)`,
		workspaceID,
		user.ID,
		defaultRole,
	); err != nil {
		return Session{}, fmt.Errorf("insert workspace member: %w", err)
	}

	session, err := s.issueSessionTx(ctx, tx, user)
	if err != nil {
		return Session{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Session{}, fmt.Errorf("commit register: %w", err)
	}

	return session, nil
}

func (s *Service) Login(ctx context.Context, input LoginInput) (Session, error) {
	email := normalizeEmail(input.Email)

	var user UserSummary
	var passwordHash string
	if err := s.pool.QueryRow(
		ctx,
		`SELECT id, email, password_hash, display_name
		 FROM users
		 WHERE lower(email) = lower($1)`,
		email,
	).Scan(&user.ID, &user.Email, &passwordHash, &user.DisplayName); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Session{}, ErrInvalidCredentials
		}
		return Session{}, fmt.Errorf("select user: %w", err)
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(input.Password)); err != nil {
		return Session{}, ErrInvalidCredentials
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Session{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	session, err := s.issueSessionTx(ctx, tx, user)
	if err != nil {
		return Session{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Session{}, fmt.Errorf("commit login: %w", err)
	}

	return session, nil
}

func (s *Service) Refresh(ctx context.Context, refreshToken string) (Session, error) {
	claims, err := s.parseRefreshToken(refreshToken)
	if err != nil {
		return Session{}, ErrInvalidRefreshToken
	}

	tokenHash := hashToken(refreshToken)

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Session{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var user UserSummary
	var storedTokenHash string
	if err := tx.QueryRow(
		ctx,
		`SELECT rt.token_hash, u.id, u.email, u.display_name
		 FROM refresh_tokens rt
		 JOIN users u ON u.id = rt.user_id
		 WHERE rt.token_hash = $1
		   AND rt.revoked_at IS NULL
		   AND rt.expires_at > NOW()`,
		tokenHash,
	).Scan(&storedTokenHash, &user.ID, &user.Email, &user.DisplayName); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Session{}, ErrInvalidRefreshToken
		}
		return Session{}, fmt.Errorf("select refresh token: %w", err)
	}

	if claims.Subject != user.ID || storedTokenHash != tokenHash {
		return Session{}, ErrInvalidRefreshToken
	}

	if _, err := tx.Exec(
		ctx,
		`UPDATE refresh_tokens
		 SET revoked_at = NOW(), last_used_at = NOW()
		 WHERE token_hash = $1 AND revoked_at IS NULL`,
		tokenHash,
	); err != nil {
		return Session{}, fmt.Errorf("revoke refresh token: %w", err)
	}

	session, err := s.issueSessionTx(ctx, tx, user)
	if err != nil {
		return Session{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Session{}, fmt.Errorf("commit refresh: %w", err)
	}

	return session, nil
}

func (s *Service) AuthenticateAccessToken(tokenString string) (string, error) {
	claims, err := s.parseAccessToken(tokenString)
	if err != nil {
		return "", ErrInvalidAccessToken
	}
	return claims.Subject, nil
}

func (s *Service) issueSessionTx(ctx context.Context, tx pgx.Tx, user UserSummary) (Session, error) {
	accessToken, err := s.issueAccessToken(user)
	if err != nil {
		return Session{}, err
	}

	refreshToken, refreshExpiry, err := s.issueRefreshToken(user)
	if err != nil {
		return Session{}, err
	}

	if _, err := tx.Exec(
		ctx,
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
		 VALUES ($1, $2, $3)`,
		user.ID,
		hashToken(refreshToken),
		refreshExpiry,
	); err != nil {
		return Session{}, fmt.Errorf("insert refresh token: %w", err)
	}

	return Session{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		User:         user,
	}, nil
}

func (s *Service) issueAccessToken(user UserSummary) (string, error) {
	now := s.now()
	claims := accessClaims{
		TokenType: "access",
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        randomTokenID(),
			Subject:   user.ID,
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(accessTokenTTL)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(s.accessSecret)
	if err != nil {
		return "", fmt.Errorf("sign access token: %w", err)
	}

	return signed, nil
}

func (s *Service) issueRefreshToken(user UserSummary) (string, time.Time, error) {
	now := s.now()
	expiresAt := now.Add(refreshTokenTTL)
	claims := refreshClaims{
		TokenType: "refresh",
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        randomTokenID(),
			Subject:   user.ID,
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(s.refreshSecret)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("sign refresh token: %w", err)
	}

	return signed, expiresAt, nil
}

func (s *Service) parseAccessToken(tokenString string) (*accessClaims, error) {
	claims := &accessClaims{}
	token, err := jwt.ParseWithClaims(
		tokenString,
		claims,
		func(token *jwt.Token) (any, error) {
			return s.accessSecret, nil
		},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, err
	}
	if !token.Valid || claims.TokenType != "access" || strings.TrimSpace(claims.Subject) == "" {
		return nil, ErrInvalidAccessToken
	}
	return claims, nil
}

func (s *Service) parseRefreshToken(tokenString string) (*refreshClaims, error) {
	claims := &refreshClaims{}
	token, err := jwt.ParseWithClaims(
		tokenString,
		claims,
		func(token *jwt.Token) (any, error) {
			return s.refreshSecret, nil
		},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, err
	}
	if !token.Valid || claims.TokenType != "refresh" || strings.TrimSpace(claims.Subject) == "" {
		return nil, ErrInvalidRefreshToken
	}
	return claims, nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func normalizeDisplayName(displayName string, email string) string {
	trimmed := strings.TrimSpace(displayName)
	if trimmed != "" {
		return trimmed
	}

	parts := strings.SplitN(email, "@", 2)
	if len(parts) > 0 && strings.TrimSpace(parts[0]) != "" {
		return strings.TrimSpace(parts[0])
	}

	return "User"
}

func buildDefaultWorkspaceName(displayName string) string {
	if strings.TrimSpace(displayName) == "" {
		return "默认工作区"
	}
	return fmt.Sprintf("%s 的工作区", strings.TrimSpace(displayName))
}

func randomTokenID() string {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		fallback := sha256.Sum256([]byte(fmt.Sprintf("%d", time.Now().UnixNano())))
		return base64.RawURLEncoding.EncodeToString(fallback[:16])
	}
	return base64.RawURLEncoding.EncodeToString(buffer)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
