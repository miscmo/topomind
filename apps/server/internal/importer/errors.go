package importer

import "errors"

var ErrInvalidImportJobID = errors.New("invalid import job id")
var ErrInvalidSourceFileName = errors.New("invalid source file name")
var ErrInvalidImportFile = errors.New("invalid import file")
var ErrImportJobNotFound = errors.New("import job not found")
