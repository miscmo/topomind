package auth

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	httpapi "topomind/apps/server/internal/http"
)

type Handler struct {
	service *Service
}

type registerRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type refreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

type sessionResponse struct {
	AccessToken  string       `json:"accessToken"`
	RefreshToken string       `json:"refreshToken"`
	User         userResponse `json:"user"`
}

type userResponse struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := decodeJSON(r, &req); err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}

	if details := validateRegisterRequest(req); len(details) > 0 {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "注册参数不完整", details)
		return
	}

	session, err := h.service.Register(r.Context(), RegisterInput(req))
	if err != nil {
		switch {
		case errors.Is(err, ErrEmailAlreadyExists):
			_ = httpapi.WriteError(w, http.StatusConflict, "email_already_exists", "邮箱已被注册", nil)
		default:
			_ = httpapi.WriteError(w, http.StatusInternalServerError, "register_failed", "注册失败", nil)
		}
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, toSessionResponse(session))
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := decodeJSON(r, &req); err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}

	if details := validateLoginRequest(req); len(details) > 0 {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "登录参数不完整", details)
		return
	}

	session, err := h.service.Login(r.Context(), LoginInput(req))
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidCredentials):
			_ = httpapi.WriteError(w, http.StatusUnauthorized, "invalid_credentials", "邮箱或密码错误", nil)
		default:
			_ = httpapi.WriteError(w, http.StatusInternalServerError, "login_failed", "登录失败", nil)
		}
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, toSessionResponse(session))
}

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := decodeJSON(r, &req); err != nil {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_json", err.Error(), nil)
		return
	}

	if strings.TrimSpace(req.RefreshToken) == "" {
		_ = httpapi.WriteError(w, http.StatusBadRequest, "invalid_request", "缺少 refreshToken", map[string]any{
			"refreshToken": "refreshToken is required",
		})
		return
	}

	session, err := h.service.Refresh(r.Context(), req.RefreshToken)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidRefreshToken):
			_ = httpapi.WriteError(w, http.StatusUnauthorized, "invalid_refresh_token", "refresh token 无效或已过期", nil)
		default:
			_ = httpapi.WriteError(w, http.StatusInternalServerError, "refresh_failed", "刷新会话失败", nil)
		}
		return
	}

	_ = httpapi.WriteOK(w, http.StatusOK, toSessionResponse(session))
}

func toSessionResponse(session Session) sessionResponse {
	return sessionResponse{
		AccessToken:  session.AccessToken,
		RefreshToken: session.RefreshToken,
		User: userResponse{
			ID:          session.User.ID,
			Email:       session.User.Email,
			DisplayName: session.User.DisplayName,
		},
	}
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()

	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(dst); err != nil {
		if errors.Is(err, io.EOF) {
			return errors.New("请求体不能为空")
		}
		return errors.New("请求体不是合法 JSON")
	}

	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("请求体只能包含一个 JSON 对象")
	}

	return nil
}

func validateRegisterRequest(req registerRequest) map[string]any {
	details := make(map[string]any)
	if strings.TrimSpace(req.Email) == "" {
		details["email"] = "email is required"
	}
	if strings.TrimSpace(req.Password) == "" {
		details["password"] = "password is required"
	}
	return details
}

func validateLoginRequest(req loginRequest) map[string]any {
	details := make(map[string]any)
	if strings.TrimSpace(req.Email) == "" {
		details["email"] = "email is required"
	}
	if strings.TrimSpace(req.Password) == "" {
		details["password"] = "password is required"
	}
	return details
}
