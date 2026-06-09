package card

import "errors"

var ErrInvalidCardName = errors.New("invalid card name")
var ErrInvalidCardStatus = errors.New("invalid card status")
var ErrInvalidCardID = errors.New("invalid card id")
var ErrInvalidKnowledgeBaseID = errors.New("invalid knowledge base id")
var ErrInvalidParentCardID = errors.New("invalid parent card id")
var ErrNoCardChanges = errors.New("no card changes")
var ErrCardNotFound = errors.New("card not found")
var ErrCardAlreadyDeleted = errors.New("card already deleted")
var ErrCardNotDeleted = errors.New("card not deleted")
var ErrCardHasChildren = errors.New("card has children")
var ErrCardHasDocuments = errors.New("card has documents")
var ErrCardHasAttachments = errors.New("card has attachments")
var ErrKnowledgeBaseNotFound = errors.New("knowledge base not found")
var ErrKnowledgeBaseDeleted = errors.New("knowledge base deleted")
var ErrParentCardNotFound = errors.New("parent card not found")
var ErrParentCardDeleted = errors.New("parent card deleted")
var ErrParentCardKnowledgeBaseMismatch = errors.New("parent card knowledge base mismatch")
