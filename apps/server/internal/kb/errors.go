package kb

import "errors"

var ErrInvalidKnowledgeBaseName = errors.New("invalid knowledge base name")
var ErrNoKnowledgeBaseChanges = errors.New("no knowledge base changes")
var ErrKnowledgeBaseNotFound = errors.New("knowledge base not found")
var ErrKnowledgeBaseAlreadyDeleted = errors.New("knowledge base already deleted")
var ErrKnowledgeBaseNotDeleted = errors.New("knowledge base not deleted")
var ErrKnowledgeBaseHasCards = errors.New("knowledge base has cards")
