-- OwnPay durable persistence schema. Apply this to PostgreSQL before enabling
-- rule approval or automation. No private keys are stored here.
create table if not exists ownpay_users (
  id text primary key,
  wallet_address text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ownpay_ownership_rules (
  id uuid primary key,
  user_id text not null references ownpay_users(id),
  wallet_address text not null,
  version integer not null,
  enabled boolean not null default false,
  trigger_asset text not null check (trigger_asset = 'USDC'),
  trigger_asset_address text not null,
  minimum_payment_raw numeric(78,0) not null,
  allocation_bps integer not null,
  allocations jsonb not null,
  max_per_payment_raw numeric(78,0) not null,
  max_daily_raw numeric(78,0) not null,
  max_monthly_raw numeric(78,0) not null,
  slippage_bps integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, version)
);

create table if not exists ownpay_payment_events (
  event_id text primary key,
  chain_id integer not null,
  transaction_hash text not null,
  log_index integer not null,
  recipient text not null,
  amount_raw numeric(78,0) not null,
  status text not null,
  detected_at timestamptz not null default now(),
  unique (chain_id, transaction_hash, log_index)
);

create table if not exists ownpay_execution_receipts (
  id uuid primary key,
  event_id text not null references ownpay_payment_events(event_id),
  rule_id uuid not null references ownpay_ownership_rules(id),
  rule_version integer not null,
  status text not null,
  transaction_hash text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
