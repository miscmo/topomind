package document

import "errors"

var ErrInvalidCardID = errors.New("invalid card id")
var ErrInvalidDocumentID = errors.New("invalid document id")
var ErrInvalidDocumentType = errors.New("invalid document type")
var ErrInvalidDocumentTitle = errors.New("invalid document title")
var ErrInvalidDocumentContentJSON = errors.New("invalid document content json")
var ErrInvalidParentDocumentID = errors.New("invalid parent document id")
var ErrInvalidBaseVersion = errors.New("invalid base version")
var ErrInvalidSchemaVersion = errors.New("invalid schema version")
var ErrNoDocumentChanges = errors.New("no document changes")
var ErrDocumentNotFound = errors.New("document not found")
var ErrDocumentAlreadyDeleted = errors.New("document already deleted")
var ErrDocumentNotDeleted = errors.New("document not deleted")
var ErrDocumentCycleDetected = errors.New("document cycle detected")
var ErrDocumentVersionConflict = errors.New("document version conflict")
var ErrCardNotFound = errors.New("card not found")
var ErrCardDeleted = errors.New("card deleted")
var ErrParentDocumentNotFound = errors.New("parent document not found")
var ErrParentDocumentDeleted = errors.New("parent document deleted")
var ErrParentDocumentCardMismatch = errors.New("parent document card mismatch")

type VersionConflictError struct {
	ServerVersion int64
	ServerEntity  Document
}

func (e *VersionConflictError) Error() string {
	return ErrDocumentVersionConflict.Error()
}

func (e *VersionConflictError) Is(target error) bool {
	return target == ErrDocumentVersionConflict
}
