ALTER TABLE local_documents
  ADD COLUMN path TEXT;

UPDATE local_documents
SET path = COALESCE(
  NULLIF(path, ''),
  NULLIF(json_extract(meta_json, '$.path'), ''),
  CASE type
    WHEN 'mindmap' THEN id || '.tmind.json'
    WHEN 'flowchart' THEN id || '.tflow.json'
    ELSE id || '.tdoc.json'
  END
)
WHERE path IS NULL OR path = '';
