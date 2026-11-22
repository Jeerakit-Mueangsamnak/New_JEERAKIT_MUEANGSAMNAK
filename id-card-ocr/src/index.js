/**
 * id-card-ocr — OCR หน้าบัตรประชาชนไทย + autofill + เก็บหลักฐาน
 *
 * Flow:
 *   POST /api/extract      -> รับรูป (FormData หรือ JSON base64), OCR ด้วย Clairic, เก็บรูปเข้า R2 (ถ้ามี), คืน field + confidence
 *   POST /api/records      -> ยืนยันแล้วบันทึก record ลง D1 + audit log
 *   GET  /api/evidence/:id -> ดึงรูปหลักฐาน
 *   GET  /api/records/:id  -> ดู record เดียว
 */

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // Clairic: 4 MiB ต่อรูป, สูงสุด 4 รูป
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

/** ฟิลด์ที่ต้องการดึงจากหน้าบัตรประชาชน */
const ID_FIELDS = {
  doc_type: { type: "text", instructions: "thai_id_card or other" },
  id_number: { type: "text", instructions: "Thai 13-digit National ID number" },
  prefix: { type: "text", instructions: "Thai title or prefix such as นาย, นาง, นางสาว" },
  first_name: { type: "text", instructions: "Thai first name" },
  last_name: { type: "text", instructions: "Thai last name" },
  first_name_en: { type: "text", instructions: "English first name" },
  last_name_en: { type: "text", instructions: "English last name" },
  birth_date: { type: "date" },
  gender: { type: "text", instructions: "male or female" },
  religion: { type: "text" },
  address: { type: "text", instructions: "Full Thai address on the card" },
  issue_date: { type: "date" },
  expiry_date: { type: "date" },
};

/** field ที่ถือว่า "จำเป็น" — ใช้คำนวณ min_confidence และ needs_review */
const REQUIRED = ["id_number", "first_name", "last_name", "birth_date"];

const worker = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "Content-Type, Authorization",
        },
      });
    }

    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (pathname === "/api/extract" && request.method === "POST") {
        return await handleExtract(request, env);
      }
      if (pathname === "/api/records" && request.method === "POST") {
        return await handleSaveRecord(request, env);
      }
      if (pathname.startsWith("/api/records/") && request.method === "GET") {
        return await handleGetRecord(pathname.split("/").pop(), env);
      }
      if (pathname.startsWith("/api/evidence/") && request.method === "GET") {
        return await handleGetEvidence(
          pathname.replace("/api/evidence/", ""),
          env,
        );
      }
      return json({ error: "not_found" }, 404);
    } catch (err) {
      console.error("unhandled", err?.stack || String(err));
      return json(
        { error: "internal_error", message: String(err?.message || err) },
        500,
      );
    }
  },
};

export default worker;

/* ------------------------------------------------------------------ */
/* OCR                                                                 */
/* ------------------------------------------------------------------ */

async function handleExtract(request, env) {
  let buf;
  let mimeType = "image/jpeg";
  let fileSize = 0;

  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    let raw = body.image || "";
    if (typeof raw !== "string" || !raw) {
      return json({ error: "missing_image" }, 400);
    }
    const match = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (match) {
      mimeType = match[1].toLowerCase();
      raw = match[2];
    }
    if (!ALLOWED_MIME.includes(mimeType)) {
      mimeType = "image/jpeg";
    }
    const binary = atob(raw);
    const u8 = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i);
    buf = u8.buffer;
    fileSize = buf.byteLength;
  } else {
    const form = await request.formData();
    const file = form.get("image");

    if (!(file instanceof File)) return json({ error: "missing_image" }, 400);
    if (!ALLOWED_MIME.includes(file.type)) {
      return json({ error: "unsupported_type", allowed: ALLOWED_MIME }, 415);
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return json(
        {
          error: "image_too_large",
          max_bytes: MAX_IMAGE_BYTES,
          got: file.size,
        },
        413,
      );
    }

    buf = await file.arrayBuffer();
    mimeType = file.type;
    fileSize = file.size;
  }

  if (fileSize > MAX_IMAGE_BYTES) {
    return json(
      { error: "image_too_large", max_bytes: MAX_IMAGE_BYTES, got: fileSize },
      413,
    );
  }

  const sha256 = await sha256Hex(buf);
  const base64 = toBase64(buf);
  const dataUri = `data:${mimeType};base64,${base64}`;

  const started = Date.now();
  const ai = await env.AI.run("@cf/cloudflare/clairic", {
    images: [dataUri],
    fields: ID_FIELDS,
    reference_date: new Date().toISOString().slice(0, 10),
  });
  const elapsedMs = Date.now() - started;

  const answers = ai.answers || {};
  const fields = {};
  const confidences = {};
  for (const [name, ans] of Object.entries(answers)) {
    fields[name] = ans?.value ?? null;
    confidences[name] = ans?.confidence ?? null;
  }

  // ตรวจ checksum เลขบัตร 13 หลัก (mod 11)
  const idValid = validThaiId(fields.id_number);

  const minConf = Math.min(
    ...REQUIRED.map((k) =>
      typeof confidences[k] === "number" ? confidences[k] : 0,
    ),
  );
  const threshold = Number(env.MIN_CONFIDENCE || 0.85);
  const needsReview =
    !idValid ||
    fields.doc_type === "other" ||
    minConf < threshold ||
    REQUIRED.some((k) => fields[k] == null);

  // เก็บรูปเป็นหลักฐานทันที (ถ้ามี R2)
  const now = new Date();
  const key = `evidence/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${extFor(mimeType)}`;

  if (env.EVIDENCE) {
    await env.EVIDENCE.put(key, buf, {
      httpMetadata: { contentType: mimeType },
      customMetadata: {
        sha256,
        captured_at: now.toISOString(),
        source: "id-card-ocr",
      },
    });
  }

  return json({
    ok: true,
    fields,
    confidences,
    checks: {
      id_number_valid: idValid,
      min_confidence: minConf,
      threshold,
      needs_review: needsReview,
    },
    evidence: { key, sha256, bytes: fileSize, mime: mimeType },
    usage: ai.usage || null,
    elapsed_ms: elapsedMs,
  });
}

/* ------------------------------------------------------------------ */
/* บันทึก record                                                       */
/* ------------------------------------------------------------------ */

async function handleSaveRecord(request, env) {
  const body = await request.json();
  const { fields = {}, evidence = {}, raw = null, consent = false } = body;

  if (!evidence.key) return json({ error: "missing_evidence" }, 400);
  if (!consent) return json({ error: "consent_required" }, 400);

  // ยืนยันว่ารูปมีอยู่จริงใน R2 (ถ้าเปิดใช้ R2)
  let headSize = evidence.bytes || 0;
  let headMime = evidence.mime || "";
  let headSha = evidence.sha256 || "";

  if (env.EVIDENCE && evidence.key !== "inline") {
    const head = await env.EVIDENCE.head(evidence.key);
    if (!head) return json({ error: "evidence_not_found" }, 404);
    if (evidence.sha256 && head.customMetadata?.sha256 !== evidence.sha256) {
      return json({ error: "evidence_hash_mismatch" }, 409);
    }
    headSize = head.size;
    headMime = head.httpMetadata?.contentType || headMime;
    headSha = head.customMetadata?.sha256 || headSha;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const idValid = validThaiId(fields.id_number);

  if (env.DB) {
    await env.DB.prepare(
      `INSERT INTO id_card_records (
         id, evidence_key, evidence_sha256, evidence_bytes, evidence_mime,
         id_number, id_number_valid, prefix, first_name, last_name,
         first_name_en, last_name_en, birth_date, gender, religion, address,
         issue_date, expiry_date, raw_json, min_confidence, needs_review,
         review_status, consent_at, created_at, created_by
       ) VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?, ?,?,?,?)`,
    )
      .bind(
        id,
        evidence.key,
        headSha,
        headSize,
        headMime,
        fields.id_number ?? null,
        idValid ? 1 : 0,
        fields.prefix ?? null,
        fields.first_name ?? null,
        fields.last_name ?? null,
        fields.first_name_en ?? null,
        fields.last_name_en ?? null,
        fields.birth_date ?? null,
        fields.gender ?? null,
        fields.religion ?? null,
        fields.address ?? null,
        fields.issue_date ?? null,
        fields.expiry_date ?? null,
        JSON.stringify(raw ?? fields),
        body.min_confidence ?? null,
        body.needs_review ? 1 : 0,
        "confirmed",
        now,
        now,
        body.actor ?? null,
      )
      .run();

    await audit(env, id, "confirmed", body.actor, `evidence=${evidence.key}`);
  }

  return json({ ok: true, id, evidence_key: evidence.key });
}

async function handleGetRecord(id, env) {
  if (!env.DB) return json({ error: "db_not_configured" }, 503);
  const row = await env.DB.prepare(`SELECT * FROM id_card_records WHERE id = ?`)
    .bind(id)
    .first();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ ok: true, record: row });
}

async function handleGetEvidence(key, env) {
  if (!env.EVIDENCE) return json({ error: "storage_not_configured" }, 503);
  const obj = await env.EVIDENCE.get(decodeURIComponent(key));
  if (!obj) return json({ error: "not_found" }, 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Evidence-SHA256", obj.customMetadata?.sha256 || "");
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(obj.body, { headers });
}

async function audit(env, recordId, action, actor, detail) {
  if (!env.DB) return;
  await env.DB.prepare(
    `INSERT INTO evidence_audit (record_id, action, actor, detail, created_at) VALUES (?,?,?,?,?)`,
  )
    .bind(
      recordId,
      action,
      actor ?? null,
      detail ?? null,
      new Date().toISOString(),
    )
    .run();
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** checksum เลขประจำตัวประชาชน 13 หลัก */
function validThaiId(id) {
  if (typeof id !== "string") return false;
  const digits = id.replace(/\D/g, "");
  if (digits.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i);
  const check = (11 - (sum % 11)) % 10;
  return check === Number(digits[12]);
}

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function extFor(mime) {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization",
    },
  });
}
