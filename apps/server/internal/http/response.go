package httpapi

import (
	"encoding/json"
	"net/http"
)

type SuccessResponse[T any] struct {
	OK   bool `json:"ok"`
	Data T    `json:"data"`
}

type ErrorResponse struct {
	OK    bool      `json:"ok"`
	Error ErrorBody `json:"error"`
}

type ErrorBody struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

func WriteJSON(w http.ResponseWriter, status int, payload any) error {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(payload)
}

func WriteOK[T any](w http.ResponseWriter, status int, data T) error {
	return WriteJSON(w, status, SuccessResponse[T]{
		OK:   true,
		Data: data,
	})
}

func WriteError(w http.ResponseWriter, status int, code string, message string, details map[string]any) error {
	return WriteJSON(w, status, ErrorResponse{
		OK: false,
		Error: ErrorBody{
			Code:    code,
			Message: message,
			Details: details,
		},
	})
}
