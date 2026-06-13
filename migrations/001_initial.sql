PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'ATIVO',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id),
  role_id TEXT NOT NULL REFERENCES roles(id),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id),
  permission_id TEXT NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS customers_snapshot (
  id TEXT PRIMARY KEY,
  codcli TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  document TEXT,
  email TEXT,
  address_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders_snapshot (
  id TEXT PRIMARY KEY,
  numped TEXT NOT NULL UNIQUE,
  codcli TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers_snapshot(id),
  branch TEXT,
  seller TEXT,
  city TEXT,
  uf TEXT,
  total_amount REAL NOT NULL DEFAULT 0,
  current_status TEXT NOT NULL DEFAULT 'PEDIDO_CRIADO',
  has_assembly INTEGER NOT NULL DEFAULT 0,
  oracle_payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items_snapshot (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders_snapshot(id),
  product_id TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL,
  requires_assembly INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  numped TEXT NOT NULL,
  codcli TEXT,
  assembly_id TEXT,
  provider_id TEXT,
  payment_id TEXT,
  previous_status TEXT,
  new_status TEXT,
  origin TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  user_id TEXT,
  ip TEXT,
  user_agent TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_timeline (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders_snapshot(id),
  event_id TEXT NOT NULL REFERENCES order_events(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  visible_to_customer INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public_tokens (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  order_id TEXT REFERENCES orders_snapshot(id),
  provider_id TEXT,
  purpose TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  document TEXT NOT NULL,
  phone TEXT NOT NULL,
  whatsapp TEXT,
  email TEXT,
  city TEXT,
  uf TEXT,
  regions_json TEXT NOT NULL DEFAULT '[]',
  service_types_json TEXT NOT NULL DEFAULT '[]',
  product_types_json TEXT NOT NULL DEFAULT '[]',
  availability_json TEXT NOT NULL DEFAULT '{}',
  capacity_per_day INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'PRE_CADASTRO',
  documents_validated INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS provider_documents (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  document_type TEXT NOT NULL,
  file_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDENTE',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS provider_approval_logs (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  action TEXT NOT NULL,
  justification TEXT NOT NULL,
  user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assembly_schedules (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders_snapshot(id),
  provider_id TEXT NOT NULL REFERENCES providers(id),
  scheduled_date TEXT NOT NULL,
  scheduled_period TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'AGENDADA',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider_id, scheduled_date, scheduled_period)
);

CREATE TABLE IF NOT EXISTS assembly_jobs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders_snapshot(id),
  schedule_id TEXT REFERENCES assembly_schedules(id),
  provider_id TEXT REFERENCES providers(id),
  status TEXT NOT NULL DEFAULT 'AGUARDANDO_AGENDAMENTO',
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assembly_photos (
  id TEXT PRIMARY KEY,
  assembly_job_id TEXT NOT NULL REFERENCES assembly_jobs(id),
  file_url TEXT NOT NULL,
  photo_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_reviews (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders_snapshot(id),
  assembly_job_id TEXT REFERENCES assembly_jobs(id),
  service_type TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 10),
  classification TEXT NOT NULL,
  comment TEXT,
  complaint_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (order_id, service_type)
);

CREATE TABLE IF NOT EXISTS sac_cases (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders_snapshot(id),
  assembly_job_id TEXT REFERENCES assembly_jobs(id),
  status TEXT NOT NULL DEFAULT 'ABERTO',
  reason TEXT NOT NULL,
  description TEXT NOT NULL,
  responsible_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS provider_payments (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  assembly_job_id TEXT NOT NULL REFERENCES assembly_jobs(id),
  amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'AGUARDANDO_FINALIZACAO',
  blocked_reason TEXT,
  programmed_for TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS message_templates (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS message_logs (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES orders_snapshot(id),
  event_id TEXT REFERENCES order_events(id),
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS winthor_sync_logs (
  id TEXT PRIMARY KEY,
  sync_type TEXT NOT NULL,
  numped TEXT,
  codcli TEXT,
  query_name TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  elapsed_ms INTEGER NOT NULL,
  origin TEXT NOT NULL,
  user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS integration_failures (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  operation TEXT NOT NULL,
  reference TEXT,
  error_message TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  previous_json TEXT,
  next_json TEXT,
  justification TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders_snapshot(current_status);
CREATE INDEX IF NOT EXISTS idx_events_numped ON order_events(numped);
CREATE INDEX IF NOT EXISTS idx_timeline_order ON order_timeline(order_id);
CREATE INDEX IF NOT EXISTS idx_public_tokens_token ON public_tokens(token);
CREATE INDEX IF NOT EXISTS idx_providers_status_active ON providers(status, active);
CREATE INDEX IF NOT EXISTS idx_payments_status ON provider_payments(status);
CREATE INDEX IF NOT EXISTS idx_sync_logs_status ON winthor_sync_logs(status);
