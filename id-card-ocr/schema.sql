-- D1 schema: id-ocr
-- รันด้วย: wrangler d1 execute id-ocr --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS id_card_records (
  id                TEXT PRIMARY KEY,          -- uuid
  evidence_key      TEXT NOT NULL,             -- R2 object key ของรูปหลักฐาน
  evidence_sha256   TEXT NOT NULL,             -- hash ของไฟล์ต้นฉบับ (integrity)
  evidence_bytes    INTEGER NOT NULL,
  evidence_mime     TEXT NOT NULL,

  id_number         TEXT,
  id_number_valid   INTEGER,                   -- 1/0 ตาม checksum 13 หลัก
  prefix            TEXT,
  first_name        TEXT,
  last_name         TEXT,
  first_name_en     TEXT,
  last_name_en      TEXT,
  birth_date        TEXT,                      -- YYYY-MM-DD
  gender            TEXT,
  religion          TEXT,
  address           TEXT,
  issue_date        TEXT,
  expiry_date       TEXT,

  raw_json          TEXT NOT NULL,             -- ผลดิบจาก Clairic (answers ทั้งก้อน)
  min_confidence    REAL,                      -- confidence ต่ำสุดในบรรดา field ที่ใช้
  needs_review      INTEGER NOT NULL DEFAULT 0,
  review_status     TEXT NOT NULL DEFAULT 'pending',  -- pending | confirmed | rejected

  consent_at        TEXT,                      -- เวลาที่ยืนยันความยินยอม (PDPA)
  created_at        TEXT NOT NULL,
  created_by        TEXT
);

CREATE INDEX IF NOT EXISTS idx_records_created ON id_card_records (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_status  ON id_card_records (review_status);
CREATE INDEX IF NOT EXISTS idx_records_idnum   ON id_card_records (id_number);

-- Audit log: ใครทำอะไรกับหลักฐานเมื่อไร (จำเป็นมากถ้าใช้เป็นพยานหลักฐาน)
CREATE TABLE IF NOT EXISTS evidence_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id   TEXT NOT NULL,
  action      TEXT NOT NULL,                   -- captured | extracted | confirmed | viewed | rejected
  actor       TEXT,
  detail      TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_record ON evidence_audit (record_id, created_at);
