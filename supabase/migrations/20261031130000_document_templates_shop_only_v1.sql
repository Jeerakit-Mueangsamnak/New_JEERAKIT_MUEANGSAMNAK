-- จัดการเอกสาร: the library holds only the shop's own forms (Master §6.2 / §25, 2026-10-31).
-- 1) The delete button deletes a form for good (audited with the reason); no more "switch off".
-- 2) Forms switched off by the old button are deleted too.
-- 3) The shop's quotation form is seeded once as a shop form (same row the web app's
--    "เพิ่มแบบฟอร์ม" writes), owned by the first active OWNER. Content = QUOTATION_STARTER_TEMPLATE
--    in features/documents/constants/initialDocumentTemplates.ts.

CREATE OR REPLACE FUNCTION public.document_template_delete(p_template_ids text[], p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_reason text := public._require_reason(p_reason);
    v_template public.document_templates%ROWTYPE;
    v_found_count integer;
    v_deleted_count integer := 0;
BEGIN
    PERFORM public._require_menu('documents');
    IF p_template_ids IS NULL OR cardinality(p_template_ids) = 0
       OR array_position(p_template_ids, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'TEMPLATE_IDS_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(DISTINCT id) FROM unnest(p_template_ids) AS id) <> cardinality(p_template_ids) THEN
        RAISE EXCEPTION 'TEMPLATE_IDS_DUPLICATE' USING ERRCODE = '22023';
    END IF;
    SELECT count(*) INTO v_found_count FROM public.document_templates WHERE id = ANY (p_template_ids);
    IF v_found_count <> cardinality(p_template_ids) THEN
        RAISE EXCEPTION 'TEMPLATE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    FOR v_template IN
        SELECT * FROM public.document_templates
        WHERE id = ANY (p_template_ids)
        FOR UPDATE
    LOOP
        DELETE FROM public.document_templates WHERE id = v_template.id;
        PERFORM public._audit(
            'DOCUMENT_TEMPLATE_DELETE', 'DOCUMENT_TEMPLATE', NULL,
            jsonb_build_object('template_id', v_template.id, 'name', v_template.name, 'category', v_template.category),
            NULL,
            v_reason, NULL
        );
        v_deleted_count := v_deleted_count + 1;
    END LOOP;
    RETURN jsonb_build_object('deleted_count', v_deleted_count);
END;
$$;

REVOKE ALL ON FUNCTION public.document_template_delete(text[], text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.document_template_delete(text[], text) TO authenticated;

DROP FUNCTION IF EXISTS public.document_template_set_status(text[], text);

DELETE FROM public.document_templates WHERE status = 'INACTIVE';

INSERT INTO public.document_templates (
    id, name, category, source, file_type, template_schema, paper_size, orientation,
    page_count, version, is_default, description, default_terms, created_by
)
SELECT
    $id$tpl-quotation$id$,
    $nm$ใบเสนอราคาค่าเช่าและบริการ (Quotation)$nm$,
    $cat$ใบเสนอราคา$cat$,
    'BUILTIN', 'HTML',
    $tpl$<div style="box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;gap:4px;width:calc(100% + 64px);height:297mm;min-height:297mm;max-height:297mm;margin:-32px;padding:5mm;overflow:hidden;background:#fff;color:#111827;font-family:Sarabun,Tahoma,'Leelawadee UI',sans-serif;font-size:15px;line-height:1.25;">
  <div style="flex-shrink:0;border:1.5px solid #111827;border-radius:6px;padding:8px;background:#fff;">
    <div style="display:grid;grid-template-columns:33.333% minmax(0,1fr);gap:8px;align-items:center;padding-bottom:4px;">
      <div style="display:flex;align-items:center;justify-content:center;min-height:92px;height:100%;padding-right:8px;border-right:1px solid #cbd5e1;overflow:hidden;">
        <img src="{{business.logo_url}}" alt="โลโก้ร้าน" style="display:block;width:100%;height:auto;max-height:125px;object-fit:contain;">
      </div>
      <div style="min-width:0;padding-left:4px;text-align:center;">
        <div style="font-size:26px;font-weight:700;line-height:32px;">{{business.name}}</div>
        <div style="font-size:16px;line-height:21px;color:#334155;">{{business.address}}</div>
        <div style="font-size:16px;line-height:20px;color:#1e293b;">โทร {{business.phone}}</div>
        <div style="font-size:16px;line-height:20px;color:#1e293b;">เลขประจำตัวผู้เสียภาษี: {{business.tax_id}}</div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:2px;margin-top:2px;padding-top:4px;border-top:1px solid #111827;">
      <div style="height:18px;font-size:14px;font-weight:700;line-height:18px;">บริการให้เช่า : ไม้แบบพลาสติก (แบบเสา, แบบเสาตอม่อ, แบบเสารั้ว, แบบคาน และนั่งร้าน)</div>
      <div style="height:18px;font-size:14px;font-weight:700;line-height:18px;">การบริการ : - จัดส่งถึงที่ - แกะระยะแบบ(ฟรี) - รูปภาพแปลนระยะไม้แบบ(ฟรี)</div>
    </div>
  </div>

  <div style="display:flex;flex-shrink:0;align-items:center;justify-content:space-between;gap:8px;height:60px;padding:3px 10px;border:1.5px solid #111827;border-radius:6px;">
    <div style="min-width:0;flex:1;">
      <div style="height:25px;font-size:20px;font-weight:700;line-height:25px;">ใบเสนอราคา / QUOTATION</div>
      <div style="margin-top:4px;color:#64748b;font-size:10px;line-height:16px;">(ต้นฉบับ / Original - สำหรับลูกค้า) <!-- QUOTATION_PAGE_MARKER --></div>
    </div>
    <div style="display:flex;flex-shrink:0;flex-direction:column;font-size:14px;">
      <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;height:21px;"><span style="font-weight:600;color:#475569;white-space:nowrap;">เลขที่เอกสาร:</span><span style="width:154px;height:20px;line-height:20px;font-weight:700;white-space:nowrap;">{{document.number}}</span></div>
      <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;height:21px;"><span style="font-weight:600;color:#475569;white-space:nowrap;">วันที่:</span><span style="width:154px;height:20px;line-height:20px;font-weight:700;white-space:nowrap;">{{document.date}}</span></div>
    </div>
  </div>

  <div style="flex-shrink:0;padding:5px 10px;border:1.5px solid #111827;border-radius:6px;">
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;font-size:13px;">
      <div style="display:flex;min-width:0;flex-direction:column;gap:4px;padding-right:12px;border-right:1px solid #cbd5e1;">
        <div style="display:flex;align-items:center;gap:6px;height:18px;"><strong style="width:33px;text-align:right;">ชื่อ:</strong><span style="flex:1;min-width:0;height:18px;line-height:18px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">{{customer.name}}</span></div>
        <div style="display:flex;align-items:center;gap:6px;height:18px;"><strong style="width:33px;text-align:right;">ที่อยู่:</strong><span style="flex:1;min-width:0;height:18px;line-height:18px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">{{customer.address}}</span></div>
        <div style="display:flex;align-items:center;gap:6px;height:18px;"><strong style="width:33px;text-align:right;"></strong><span style="flex:1;min-width:0;height:18px;line-height:18px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;"></span></div>
      </div>
      <div style="display:flex;min-width:0;flex-direction:column;gap:4px;">
        <div style="display:flex;align-items:center;gap:6px;height:18px;"><strong style="width:83px;text-align:right;white-space:nowrap;">เลขผู้เสียภาษี:</strong><span style="flex:1;min-width:0;height:18px;line-height:18px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">{{customer.tax_id}}</span></div>
        <div style="display:flex;align-items:center;gap:6px;height:18px;"><strong style="width:83px;text-align:right;white-space:nowrap;">เบอร์โทร:</strong><span style="flex:1;min-width:0;height:18px;line-height:18px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">{{customer.phone}}</span></div>
        <div style="display:flex;align-items:center;gap:6px;height:18px;"><strong style="width:83px;text-align:right;white-space:nowrap;">สถานที่จัดส่ง:</strong><span style="flex:1;min-width:0;height:18px;line-height:18px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">{{document.site_name}}</span></div>
      </div>
    </div>
  </div>

  <div style="flex-shrink:0;overflow:hidden;border:1.5px solid #111827;border-radius:6px;">
    
    <table aria-label="รายการสินค้าใบเสนอราคา" style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px;color:#111827;">
      <thead>
        <tr>
          
            <th style="width:6%;height:25px;background:#f1f5f9;text-align:center;border-right:1px solid #64748b;border-bottom:1px solid #64748b;padding:0 3px;">ลำดับ</th>
          
            <th style="width:38%;height:25px;background:#f1f5f9;text-align:center;border-right:1px solid #64748b;border-bottom:1px solid #64748b;padding:0 3px;">รายการ</th>
          
            <th style="width:8%;height:25px;background:#f1f5f9;text-align:center;border-right:1px solid #64748b;border-bottom:1px solid #64748b;padding:0 3px;">จำนวน</th>
          
            <th style="width:8%;height:25px;background:#f1f5f9;text-align:center;border-right:1px solid #64748b;border-bottom:1px solid #64748b;padding:0 3px;">หน่วย</th>
          
            <th style="width:11%;height:25px;background:#f1f5f9;text-align:center;border-right:1px solid #64748b;border-bottom:1px solid #64748b;padding:0 3px;">ราคา</th>
          
            <th style="width:13%;height:25px;background:#f1f5f9;text-align:center;border-right:1px solid #64748b;border-bottom:1px solid #64748b;padding:0 3px;">การเช่า</th>
          
            <th style="width:16%;height:25px;background:#f1f5f9;text-align:center;border-bottom:1px solid #64748b;padding:0 3px;">จำนวนเงิน</th>
          
        </tr>
      </thead>
      <tbody>{{items.rows_quotation_16}}</tbody>
    </table>
  
  </div>

  <!-- QUOTATION_FINAL_START -->
  <div style="display:grid;flex-shrink:0;grid-template-columns:minmax(0,56fr) minmax(0,44fr);gap:8px;">
    <div style="box-sizing:border-box;height:128px;min-width:0;padding:6px 8px;border:1.5px solid #111827;border-radius:6px;">
      <div style="margin-bottom:4px;font-size:13px;font-weight:700;line-height:18px;color:#1e293b;">หมายเหตุ / Terms &amp; Conditions:</div>
      <div style="font-size:12px;line-height:18px;white-space:pre-line;">{{document.custom_terms}}</div>
    </div>
    <div style="box-sizing:border-box;height:128px;overflow:hidden;border:1.5px solid #111827;border-radius:6px;">
      <table style="width:100%;height:100%;border-collapse:collapse;table-layout:fixed;font-size:13px;">
        <tbody>
          <tr style="height:16.66%;border-bottom:1px solid #64748b;"><td style="padding:1px 8px;">รวมเป็นเงิน (Subtotal)</td><td style="width:44%;border-left:1px solid #64748b;padding:1px 8px;text-align:right;font-size:12px;font-weight:600;">{{bill.subtotal}}</td></tr>
          <tr style="height:16.66%;border-bottom:1px solid #64748b;background:#f8fafc;"><td style="padding:1px 8px;">ส่วนลด (Discount)</td><td style="width:44%;border-left:1px solid #64748b;padding:1px 8px;text-align:right;font-size:12px;font-weight:600;color:#be123c;">{{bill.discount}}</td></tr>
          <tr style="height:16.66%;border-bottom:1px solid #64748b;"><td style="padding:1px 8px;">ค่าขนส่ง (Delivery)</td><td style="width:44%;border-left:1px solid #64748b;padding:1px 8px;text-align:right;font-size:12px;font-weight:600;">{{bill.shipping_fee}}</td></tr>
          <tr style="height:16.66%;border-bottom:1px solid #64748b;background:#fffbeb;"><td style="padding:1px 8px;white-space:nowrap;">ภาษีมูลค่าเพิ่ม&nbsp; <span style="display:inline-block;min-width:50px;height:16px;line-height:14px;border:1px solid #cbd5e1;border-radius:4px;text-align:center;font-weight:700;color:#065f46;">{{document.vat_label}}</span> (VAT)</td><td style="width:44%;border-left:1px solid #64748b;padding:1px 8px;text-align:right;font-size:12px;font-weight:600;">{{bill.tax_amount}}</td></tr>
          <tr style="height:16.66%;border-bottom:1px solid #64748b;background:#f1f5f9;"><td style="padding:1px 8px;font-weight:800;white-space:nowrap;">จำนวนเงินรวมทั้งสิ้น</td><td style="width:44%;border-left:1px solid #64748b;padding:1px 8px;text-align:right;font-size:12px;font-weight:800;color:#065f46;">{{bill.grand_total}}</td></tr>
          <tr style="height:16.66%;"><td style="padding:1px 8px;white-space:nowrap;color:#92400e;">มัดจำ (ไม่รวมยอด)</td><td style="width:44%;border-left:1px solid #64748b;padding:1px 8px;text-align:right;font-size:12px;font-weight:600;color:#92400e;">{{bill.deposit_amount}}</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div style="flex-shrink:0;padding:4px 10px;border:1.5px solid #111827;border-radius:6px;font-size:15px;">
    <strong>จำนวนเงินตัวอักษร:</strong> <span style="font-weight:700;">({{bill.grand_total_text}})</span>
  </div>

  <div style="flex-shrink:0;margin-top:0;padding:8px 12px;border:1.5px solid #111827;border-radius:6px;">
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;text-align:center;">
      <div style="position:relative;height:103.5px;min-width:0;padding:0 8px;border-right:1px solid #64748b;">
        <div style="font-size:12px;font-weight:700;color:#1e293b;white-space:nowrap;">ผู้เสนอราคา / จัดทำโดย</div>
        <div style="position:absolute;right:8px;bottom:23px;left:8px;"><div style="width:80%;margin:auto;border-bottom:1px dotted #64748b;"></div><div style="height:18px;margin-top:2px;font-size:14px;line-height:18px;">(________________________)</div></div>
        <div style="position:absolute;right:0;bottom:0;left:0;font-size:14px;line-height:20px;color:#64748b;">วันที่ __________________</div>
      </div>
      <div style="position:relative;height:103.5px;min-width:0;padding:0 8px;border-right:1px solid #64748b;">
        <div style="font-size:12px;font-weight:700;color:#1e293b;white-space:nowrap;">ผู้ตรวจสอบ / ฝ่ายบริหาร</div>
        <div style="position:absolute;right:8px;bottom:23px;left:8px;"><div style="width:80%;margin:auto;border-bottom:1px dotted #64748b;"></div><div style="height:18px;margin-top:2px;font-size:14px;line-height:18px;">(________________________)</div></div>
        <div style="position:absolute;right:0;bottom:0;left:0;font-size:14px;line-height:20px;color:#64748b;">วันที่ __________________</div>
      </div>
      <div style="position:relative;height:103.5px;min-width:0;padding:0 8px;">
        <div style="font-size:12px;font-weight:700;color:#1e293b;white-space:nowrap;">อนุมัติสั่งจ้าง / สั่งเช่า (ลูกค้า)</div>
        <div style="position:absolute;right:8px;bottom:23px;left:8px;"><div style="width:80%;margin:auto;border-bottom:1px dotted #64748b;"></div><div style="height:18px;margin-top:2px;font-size:14px;line-height:18px;">(________________________)</div></div>
        <div style="position:absolute;right:0;bottom:0;left:0;font-size:14px;line-height:20px;color:#64748b;">วันที่ __________________</div>
      </div>
    </div>
  </div>
  <!-- QUOTATION_FINAL_END -->
</div>$tpl$,
    'A4', 'PORTRAIT', 1, 1, true,
    $dsc$แบบฟอร์มใบเสนอราคาพิมพ์หลายหน้า แสดงรายการครบพร้อมยอดรวมและลงนามเฉพาะหน้าสุดท้าย$dsc$,
    $trm$1. กำหนดส่งมอบสินค้าภายใน 3-5 วันทำการ หลังจากได้รับการยืนยันใบสั่งจ้าง/สั่งเช่า
2. การชำระเงิน: มัดจำ 30% ณ วันสั่งจ้าง และส่วนที่เหลือชำระ ณ วันส่งมอบสินค้า
3. สินค้าเช่าต้องส่งคืนในสภาพสมบูรณ์ หากชำรุดหรือสูญหายคิดค่าปรับตามราคาตลาด$trm$,
    p.id
FROM public.profiles AS p
WHERE p.role = 'OWNER' AND p.status = 'ACTIVE'
ORDER BY p.created_at
LIMIT 1
ON CONFLICT (id) DO NOTHING;
