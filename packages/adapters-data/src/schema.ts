// Versioned DDL runs under one transaction/advisory lock before schema use.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS factory_schema (version integer PRIMARY KEY, installed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS factory_projects (
  name text PRIMARY KEY, data jsonb NOT NULL,
  CHECK (data->>'name' = name)
);
CREATE TABLE IF NOT EXISTS factory_tasks (
  project text NOT NULL REFERENCES factory_projects(name), id uuid NOT NULL, data jsonb NOT NULL,
  stage text GENERATED ALWAYS AS (data->>'stage') STORED,
  PRIMARY KEY(project,id), CHECK (data->>'project' = project AND data->>'id' = id::text)
);
CREATE INDEX IF NOT EXISTS factory_tasks_stage ON factory_tasks(project,stage);
CREATE TABLE IF NOT EXISTS factory_documents (
  path text PRIMARY KEY, kind text NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS factory_run_states ON factory_documents((data->>'state')) WHERE kind = 'run';
CREATE TABLE IF NOT EXISTS factory_artifacts (
  stream text NOT NULL, sequence bigint NOT NULL, object_key text NOT NULL UNIQUE,
  bytes integer NOT NULL CHECK(bytes >= 0), sha256 text NOT NULL,
  PRIMARY KEY(stream,sequence)
);
CREATE TABLE IF NOT EXISTS factory_trace_events (
  stream text NOT NULL, sequence bigint NOT NULL, run_id text NOT NULL, kind text NOT NULL,
  data jsonb NOT NULL, PRIMARY KEY(stream,sequence),
  FOREIGN KEY(stream,sequence) REFERENCES factory_artifacts(stream,sequence)
);
CREATE INDEX IF NOT EXISTS factory_trace_runs ON factory_trace_events(run_id,kind);
INSERT INTO factory_schema(version) VALUES(1) ON CONFLICT DO NOTHING;
`;
