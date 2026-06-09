ALTER TABLE local_documents
  RENAME COLUMN path TO file_name;

UPDATE local_documents
SET file_name = CASE type
  WHEN 'mindmap' THEN id || '.tmind.json'
  WHEN 'flowchart' THEN id || '.tflow.json'
  ELSE id || '.tdoc.json'
END
WHERE file_name IS NULL OR trim(file_name) = '';
