package graphlayout

import "errors"

var ErrInvalidGraphLayoutID = errors.New("invalid graph layout id")
var ErrInvalidKnowledgeBaseID = errors.New("invalid knowledge base id")
var ErrInvalidRoomCardID = errors.New("invalid room card id")
var ErrInvalidLayoutJSON = errors.New("invalid layout json")
var ErrInvalidViewportJSON = errors.New("invalid viewport json")
var ErrInvalidBaseVersion = errors.New("invalid base version")
var ErrNoGraphLayoutChanges = errors.New("no graph layout changes")
var ErrGraphLayoutNotFound = errors.New("graph layout not found")
var ErrGraphLayoutVersionConflict = errors.New("graph layout version conflict")
var ErrGraphLayoutScopeMismatch = errors.New("graph layout scope mismatch")
var ErrKnowledgeBaseNotFound = errors.New("knowledge base not found")
var ErrKnowledgeBaseDeleted = errors.New("knowledge base deleted")
var ErrRoomCardNotFound = errors.New("room card not found")
var ErrRoomCardDeleted = errors.New("room card deleted")
var ErrRoomCardKnowledgeBaseMismatch = errors.New("room card knowledge base mismatch")

type VersionConflictError struct {
	ServerVersion int64
	ServerEntity  GraphLayout
}

func (e *VersionConflictError) Error() string {
	return ErrGraphLayoutVersionConflict.Error()
}

func (e *VersionConflictError) Is(target error) bool {
	return target == ErrGraphLayoutVersionConflict
}
