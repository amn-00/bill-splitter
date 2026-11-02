-- D1 enforces foreign keys by default.

CREATE TABLE homes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- 1, 2, 3... inside a home. The split gives extra cents in this order.
  position INTEGER NOT NULL,
  -- A member cannot belong to a home that does not exist.
  CONSTRAINT fk_members_home FOREIGN KEY (home_id) REFERENCES homes (id),
  -- Two members of the same home cannot share a position, so the order is always clear.
  CONSTRAINT uq_members_home_position UNIQUE (home_id, position)
);

CREATE TABLE bills (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  -- A bill cannot belong to a home that does not exist.
  CONSTRAINT fk_bills_home FOREIGN KEY (home_id) REFERENCES homes (id),
  -- A bill must be a positive amount.
  CONSTRAINT ck_bills_total_positive CHECK (total_cents > 0)
);

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  -- NULL means unpaid.
  paid_at TEXT,
  -- The Idempotency-Key of the request that paid this share.
  idempotency_key TEXT,
  -- A share cannot point to a bill or a member that does not exist.
  CONSTRAINT fk_shares_bill FOREIGN KEY (bill_id) REFERENCES bills (id),
  CONSTRAINT fk_shares_member FOREIGN KEY (member_id) REFERENCES members (id),
  -- A share can be 0 (e.g. 2 cents split between 3 people) but never negative.
  CONSTRAINT ck_shares_amount_not_negative CHECK (amount_cents >= 0)
);
