import { DocumentTemplate } from '@/lib/types/document'

export const INITIAL_DOC_CATEGORIES = [
  'ใบเสนอราคา',
  'ใบจองสินค้า',
  'ใบแจ้งหนี้/บิลเช่า',
  'ใบเสร็จรับเงิน',
  'ใบกำกับภาษี',
  'ใบเสร็จรับเงิน/ใบกำกับภาษี',
  'ใบส่งสินค้า/ติดตั้ง',
  'ใบเช็กของ (ส่ง/เก็บคืน)',
  'สัญญาเช่าสินค้า',
  'ใบรับคืนสินค้า',
  'ใบรับเงินมัดจำ',
  'ใบสำคัญจ่าย',
  'สเตทเมนต์',
  'ใบเสร็จค่าชำรุด',
  'ใบแจ้งหนี้ค่าชำรุด',
  'หนังสือมอบอำนาจ',
  'แบบฟอร์มอื่น ๆ'
]

export const CUSTOMER_DOC_CATEGORIES = [
  'สัญญาเช่าสินค้า',
  'แบบฟอร์มยืนยันลายเซ็น',
  'หนังสือมอบอำนาจ',
  'เอกสารยินยอม/ข้อตกลง',
  'แบบฟอร์มลูกค้าอื่น ๆ'
]

export const BILL_DOC_CATEGORIES = [
  'ใบเสนอราคา',
  'ใบจองสินค้า',
  'ใบแจ้งหนี้/บิลเช่า',
  'ใบเสร็จรับเงิน',
  'ใบกำกับภาษี',
  'ใบเสร็จรับเงิน/ใบกำกับภาษี',
  'ใบส่งสินค้า/ติดตั้ง',
  'ใบเช็กของ (ส่ง/เก็บคืน)',
  'ใบรับคืนสินค้า',
  'ใบรับเงินมัดจำ',
  'ใบสำคัญจ่าย',
  'สเตทเมนต์',
  'ใบเสร็จค่าชำรุด',
  'ใบแจ้งหนี้ค่าชำรุด',
  'แบบฟอร์มบิลอื่น ๆ'
]

// Base HTML header generator for template schema consistency
function renderTemplateHeader(docTitle: string, _docCategoryBadge?: string, numberLabel = 'เลขที่เอกสาร') {
  return `
  <!-- Header Info -->
  <div class="mb-2 flex items-start justify-between gap-3 border-b-2 border-red-700 pb-2.5">
    <div class="flex items-start gap-2.5">
      <div class="flex h-11 w-11 items-center justify-center rounded-lg bg-red-700 text-white font-black text-xs shrink-0 shadow-xs">
        LOGO
      </div>
      <div>
        <h1 class="whitespace-nowrap text-[16px] font-black uppercase tracking-tight text-slate-900 leading-none">
          {{business.name}}
        </h1>
        <p class="text-slate-600 text-[8.5px] mt-1 max-w-md leading-tight">
          {{business.address}}
        </p>
        <p class="text-slate-600 text-[8.5px]">
          เลขประจำตัวผู้เสียภาษี: <span class="font-semibold text-slate-900">{{business.tax_id}}</span> | โทร: <span class="font-semibold text-slate-900">{{business.phone}}</span> | อีเมล: {{business.email}}
        </p>
        <p class="text-red-800 font-medium text-[8px] mt-0.5">{{business.description}}</p>
      </div>
    </div>

    <div class="text-right shrink-0">
      <div class="mb-1 inline-block whitespace-nowrap rounded bg-red-700 px-3 py-1 font-black text-[10.5px] uppercase tracking-wider text-white shadow-xs">
        ${docTitle}
      </div>
      <p class="whitespace-nowrap text-[10px] font-bold text-slate-800">
        ${numberLabel}: <span class="text-red-700 font-extrabold">{{document.number}}</span>
      </p>
      <p class="text-slate-600 text-[8.5px]">
        วันที่ออกเอกสาร: {{document.date}}
      </p>
    </div>
  </div>
  `
}

// Base 20-row standard table schema
function renderStandard20ItemTable(headers: { col2?: string; col6?: string } = {}) {
  const col2Title = headers.col2 || 'รายการสินค้า / รายละเอียด'
  const col6Title = headers.col6 || 'การเช่า'

  return `
  <!-- Items Table (Exactly 20 Rows) -->
  <div class="mb-2 w-full overflow-hidden">
    <table class="w-full table-fixed border-collapse text-[8.5px] leading-tight border border-slate-400">
      <thead>
        <tr class="bg-slate-900 text-white font-extrabold border-b-2 border-red-700">
          <th class="w-[6%] border border-slate-700 px-1 py-1 text-center">ลำดับ</th>
          <th class="w-[34%] border border-slate-700 px-1.5 py-1 text-left">${col2Title}</th>
          <th class="w-[8%] border border-slate-700 px-1 py-1 text-center">จำนวน</th>
          <th class="w-[8%] border border-slate-700 px-1 py-1 text-center">หน่วย</th>
          <th class="w-[14%] border border-slate-700 px-1.5 py-1 text-right">ราคา/หน่วย</th>
          <th class="w-[12%] border border-slate-700 px-1 py-1 text-center">${col6Title}</th>
          <th class="w-[18%] border border-slate-700 px-1.5 py-1 text-right">รวมเงิน (บาท)</th>
        </tr>
      </thead>
      <tbody>
        {{items.rows_standard_20}}
      </tbody>
    </table>
  </div>
  `
}

function renderQuotationTable() {
  const widths = ['6%', '38%', '8%', '8%', '11%', '13%', '16%']

  return `
    <table aria-label="รายการสินค้า 16 แถว" style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px;color:#111827;">
      <thead>
        <tr>
          ${['ลำดับ', 'รายการ', 'จำนวน', 'หน่วย', 'ราคา', 'การเช่า', 'จำนวนเงิน'].map((label, index) => `
            <th style="width:${widths[index]};height:25px;background:#f1f5f9;text-align:center;${index < widths.length - 1 ? 'border-right:1px solid #64748b;' : ''}border-bottom:1px solid #64748b;padding:0 3px;">${label}</th>
          `).join('')}
        </tr>
      </thead>
      <tbody>{{items.rows_quotation_16}}</tbody>
    </table>
  `
}

// Base Bank + QR info box
function renderBankAndQrBox() {
  return `
  <div class="flex items-center justify-between rounded border border-slate-300 bg-white p-2 text-[8.5px]">
    <div>
      <p class="font-extrabold text-red-800 text-[9px] mb-0.5">ข้อมูลการชำระเงินผ่านธนาคาร:</p>
      <p><span class="font-bold">ธนาคาร:</span> {{business.bank_name}}</p>
      <p><span class="font-bold">ชื่อบัญชี:</span> {{business.bank_account_name}}</p>
      <p><span class="font-bold">เลขที่บัญชี:</span> <span class="font-mono font-bold text-slate-900">{{business.bank_account_number}}</span></p>
      <p><span class="font-bold">พร้อมเพย์:</span> <span class="font-mono">{{business.promptpay}}</span></p>
    </div>

    <div class="text-center shrink-0 pl-2">
      <div class="h-12 w-12 border border-dashed border-red-700 bg-red-50 flex items-center justify-center text-[7px] text-red-700 font-bold rounded">
        QR Pay
      </div>
      <span class="text-[7.5px] text-slate-500 font-medium block mt-0.5">สแกนชำระเงิน</span>
    </div>
  </div>
  `
}

// Base Dual Signature Box
function renderSignatureBox(leftLabel: string, leftSub: string, rightLabel: string, rightSub: string) {
  return `
  <!-- Signatures Zone -->
  <div class="mt-auto grid grid-cols-2 gap-8 border-t border-slate-300 pt-2 text-center text-[8.5px]">
    <div>
      <div class="mx-auto mb-1 h-6 w-40 border-b border-dashed border-slate-400"></div>
      <p class="font-bold text-slate-900">${leftLabel}</p>
      <p class="text-slate-500 text-[8px]">${leftSub}</p>
      <p class="text-slate-400 text-[7.5px]">วันที่ _____/_____/_________</p>
    </div>
    <div>
      <div class="mx-auto mb-1 h-6 w-40 border-b border-dashed border-slate-400"></div>
      <p class="font-bold text-slate-900">${rightLabel}</p>
      <p class="text-slate-500 text-[8px]">${rightSub}</p>
      <p class="text-slate-400 text-[7.5px]">วันที่ _____/_____/_________</p>
    </div>
  </div>
  `
}

export const INITIAL_TEMPLATES: DocumentTemplate[] = [
  // 1. QUOTATION (ใบเสนอราคา)
  {
    id: 'tpl_quotation',
    name: 'ใบเสนอราคาค่าเช่าและบริการ (Quotation)',
    category: 'ใบเสนอราคา',
    source: 'BUILTIN',
    fileType: 'HTML',
    version: 1,
    paperSize: 'A4',
    orientation: 'PORTRAIT',
    pageCount: 1,
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    createdBy: 'ระบบ',
    description: 'แบบฟอร์มใบเสนอราคาตามรูปแบบกิจการ มีตาราง 16 บรรทัด สรุปยอด และช่องลงนาม 3 ฝ่าย',
    defaultTerms: '1. กำหนดส่งมอบสินค้าภายใน 3-5 วันทำการ หลังจากได้รับการยืนยันใบสั่งจ้าง/สั่งเช่า\n2. การชำระเงิน: มัดจำ 30% ณ วันสั่งจ้าง และส่วนที่เหลือชำระ ณ วันส่งมอบสินค้า\n3. สินค้าเช่าต้องส่งคืนในสภาพสมบูรณ์ หากชำรุดหรือสูญหายคิดค่าปรับตามราคาตลาด',
    templateSchema: `
<div style="box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;gap:4px;width:calc(100% + 64px);height:297mm;min-height:297mm;max-height:297mm;margin:-32px;padding:5mm;overflow:hidden;background:#fff;color:#111827;font-family:Sarabun,Tahoma,'Leelawadee UI',sans-serif;font-size:15px;line-height:1.25;">
  <div style="flex-shrink:0;border:1.5px solid #111827;border-radius:6px;padding:8px;background:#fff;">
    <div style="display:grid;grid-template-columns:33.333% minmax(0,1fr);gap:8px;align-items:center;padding-bottom:4px;">
      <div style="display:flex;align-items:center;justify-content:center;min-height:92px;height:100%;padding-right:8px;border-right:1px solid #cbd5e1;overflow:hidden;">
        <img src="/logo.png" alt="JJK Jeerakit Plastic Formwork" style="display:block;width:100%;height:auto;max-height:125px;object-fit:contain;">
      </div>
      <div style="min-width:0;padding-left:4px;text-align:center;">
        <div style="font-size:30px;font-weight:700;line-height:35px;">จีรกิตติ์ ไม้แบบพลาสติก อุตรดิตถ์</div>
        <div style="font-size:21px;font-weight:600;line-height:25px;color:#334155;">JEERAKIT PLASTIC FORMWORK UTTARADIT</div>
        <div style="font-size:16px;line-height:21px;color:#334155;">98/12 หมู่ 4 ต.ท่าเสา อ.เมืองอุตรดิตถ์ จ.อุตรดิตถ์ 53000</div>
        <div style="font-size:16px;line-height:20px;color:#1e293b;">โทร 093-170-3949 , 093-282-8517</div>
        <div style="font-size:16px;line-height:20px;color:#1e293b;">เลขประจำตัวผู้เสียภาษี: 1-5399-00535-23-9</div>
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
      <div style="margin-top:4px;color:#64748b;font-size:10px;line-height:16px;">(ต้นฉบับ / Original - สำหรับลูกค้า)</div>
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
    ${renderQuotationTable()}
  </div>

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
          <tr style="height:16.66%;border-bottom:1px solid #64748b;background:#f1f5f9;"><td style="padding:1px 8px;font-weight:800;white-space:nowrap;">จำนวนเงินรวมทั้งสิ้น</td><td style="width:44%;border-left:1px solid #64748b;padding:1px 8px;text-align:right;font-size:12px;font-weight:800;color:#065f46;">฿{{bill.grand_total}}</td></tr>
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
</div>
    `.trim()
  },

  // 2. RESERVATION (ใบจองสินค้า)
  {
    id: 'tpl_reservation',
    name: 'ใบจองสินค้าและยืนยันการจอง (Reservation Confirmation)',
    category: 'ใบจองสินค้า',
    source: 'BUILTIN',
    fileType: 'HTML',
    version: 1,
    paperSize: 'A4',
    orientation: 'PORTRAIT',
    pageCount: 1,
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    createdBy: 'ระบบ',
    description: 'เอกสารยืนยันสิทธิ์การล็อคสต็อกสินค้าล่วงหน้า พร้อมบันทึกเงินมัดจำการจองและกำหนดการจัดส่ง',
    defaultTerms: '1. การจองสินค้าจะสมบูรณ์เมื่อชำระเงินมัดจำการจองเรียบร้อยแล้ว\n2. กรณีขอยกเลิกการจองล่วงหน้าน้อยกว่า 3 วันทำการ ขอสงวนสิทธิ์การคืนเงินมัดจำ\n3. บริษัทการันตีความพร้อมของสินค้าตามวันและเวลาที่กำหนด',
    templateSchema: `
<div class="box-border flex h-full w-full flex-col justify-between overflow-hidden bg-white px-[10mm] py-[8mm] font-sans text-[9.5px] leading-[1.3] text-slate-900">
  ${renderTemplateHeader('ใบยืนยันการจองสินค้า / RESERVATION', 'ใบจองสินค้า')}

  <div class="mb-2 grid grid-cols-2 gap-3 rounded border border-slate-300 bg-slate-50/80 p-2 text-[9px]">
    <div>
      <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">ข้อมูลผู้จอง (Customer):</h4>
      <p class="whitespace-nowrap font-bold text-slate-900 text-[10px]">{{customer.name}}</p>
      <p class="text-slate-600 truncate">{{customer.address}}</p>
      <p class="text-slate-600">โทร: <span class="font-semibold text-slate-900">{{customer.phone}}</span> | เลขผู้เสียภาษี: {{customer.tax_id}}</p>
    </div>
    <div>
      <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">กำหนดการใช้งานและจัดส่ง:</h4>
      <p>วันเริ่มส่งมอบ/รับของ: <span class="font-bold text-slate-900">{{document.rental_start_date}}</span></p>
      <p>กำหนดการส่งคืน: <span class="font-bold text-slate-900">{{document.rental_end_date}}</span></p>
      <p>สถานที่จัดงาน/หน้างาน: <span class="font-semibold text-slate-800">{{document.site_name}}</span></p>
    </div>
  </div>

  ${renderStandard20ItemTable({ col2: 'รายการอุปกรณ์ที่จองล็อคสต็อก', col6: 'ระยะเวลาจอง' })}

  <div class="mb-2 grid grid-cols-12 gap-3 items-start">
    <div class="col-span-7 space-y-1.5">
      <div class="rounded border border-slate-300 bg-slate-50/70 p-2 text-[8px] leading-relaxed text-slate-700">
        <p class="font-extrabold text-red-800 mb-0.5 text-[8.5px]">ข้อกำหนดสิทธิ์การจอง:</p>
        <p class="whitespace-pre-line">{{document.custom_terms}}</p>
      </div>
      ${renderBankAndQrBox()}
    </div>

    <div class="col-span-5 rounded border border-slate-300 bg-slate-50 p-2 text-[8.5px] space-y-0.5">
      <div class="flex justify-between border-b border-slate-200 py-0.5">
        <span class="text-slate-600">มูลค่ารวมประมาณการ:</span>
        <span class="font-mono font-bold">฿{{bill.grand_total}}</span>
      </div>
      <div class="flex justify-between border-b border-slate-200 py-0.5 text-emerald-700 font-bold">
        <span>เงินมัดจำจองที่ชำระแล้ว:</span>
        <span class="font-mono">฿{{bill.paid_amount}}</span>
      </div>
      <div class="flex justify-between rounded bg-red-700 p-1.5 text-white font-extrabold text-[9.5px] mt-1 shadow-xs">
        <span>ยอดคงเหลือชำระวันรับของ:</span>
        <span class="font-mono">฿{{bill.outstanding_amount}}</span>
      </div>
    </div>
  </div>

  ${renderSignatureBox('ลงชื่อ ( {{customer.name}} )', 'ผู้จองสินค้า / ผู้รับสิทธิ์', 'ลงชื่อ ( {{business.authorized_person}} )', '{{business.name}} (เจ้าหน้าที่รับจอง)')}
</div>
    `.trim()
  },

  // 3. RENTAL_BILL (ใบแจ้งหนี้ / บิลเช่าสินค้า)
  {
    id: 'tpl_rental_bill',
    name: 'ใบแจ้งหนี้และบิลเช่าสินค้า (Rental Bill & Invoice)',
    category: 'ใบแจ้งหนี้/บิลเช่า',
    source: 'BUILTIN',
    fileType: 'HTML',
    version: 1,
    paperSize: 'A4',
    orientation: 'PORTRAIT',
    pageCount: 1,
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    createdBy: 'ระบบ',
    description: 'บิลเช่าสินค้ามาตรฐาน ระบบ 20 แถว พร้อมแจกแจงค่าเช่า ค่ามัดจำ ยอดชำระ และยอดคงค้าง',
    defaultTerms: '1. สินค้าที่เกินกำหนดเวลาเช่าคิดค่าปรับรายวันตามอัตราจริง\n2. กรณีสินค้าชำรุดเสียหายคิดค่าซ่อมตามราคาศูนย์บริการ\n3. คืนเงินมัดจำประกันภายใน 1-3 วันทำการหลังตรวจรับอุปกรณ์',
    templateSchema: `
<div class="box-border flex h-full w-full flex-col justify-between overflow-hidden bg-white px-[10mm] py-[8mm] font-sans text-[9.5px] leading-[1.3] text-slate-900">
  ${renderTemplateHeader('ใบแจ้งหนี้ / บิลเช่าสินค้า', 'ใบแจ้งหนี้/บิลเช่า')}

  <div class="mb-2 grid grid-cols-2 gap-3 rounded border border-slate-300 bg-slate-50/80 p-2 text-[9px]">
    <div>
      <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">ข้อมูลผู้เช่า / ลูกค้า (Customer):</h4>
      <p class="whitespace-nowrap font-bold text-slate-900 text-[10px]">{{customer.name}}</p>
      <p class="text-slate-600 truncate">{{customer.company_name}}</p>
      <p class="text-slate-600 truncate">{{customer.address}}</p>
      <p class="text-slate-600">โทร: <span class="font-semibold text-slate-900">{{customer.phone}}</span> | เลขผู้เสียภาษี: {{customer.tax_id}}</p>
    </div>
    <div>
      <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">กำหนดการเช่าสินค้า:</h4>
      <p>วันเริ่มเช่า: <span class="font-bold text-slate-900">{{document.rental_start_date}}</span> | กำหนดคืน: <span class="font-bold text-slate-900">{{document.rental_end_date}}</span></p>
      <p>สถานที่ใช้งาน/หน้างาน: <span class="font-semibold text-slate-800">{{document.site_name}}</span></p>
    </div>
  </div>

  ${renderStandard20ItemTable({ col2: 'รายการสินค้าและอุปกรณ์เช่า', col6: 'การเช่า' })}

  <div class="mb-2 grid grid-cols-12 gap-3 items-start">
    <div class="col-span-7 space-y-1.5">
      <div class="rounded border border-slate-300 bg-slate-50/70 p-2 text-[8px] leading-relaxed text-slate-700">
        <p class="font-extrabold text-red-800 mb-0.5 text-[8.5px]">ข้อกำหนดและเงื่อนไขการเช่า:</p>
        <p class="whitespace-pre-line">{{document.custom_terms}}</p>
      </div>
      ${renderBankAndQrBox()}
    </div>

    <div class="col-span-5 rounded border border-slate-300 bg-slate-50 p-2 text-[8.5px] space-y-0.5">
      <div class="flex justify-between border-b border-slate-200 py-0.5">
        <span class="text-slate-600">มูลค่ารวมก่อนส่วนลด:</span>
        <span class="font-mono font-bold">฿{{bill.subtotal}}</span>
      </div>
      <div class="flex justify-between border-b border-slate-200 py-0.5 text-emerald-700 font-bold">
        <span>ส่วนลด:</span>
        <span class="font-mono">-฿{{bill.discount}}</span>
      </div>
      <div class="flex justify-between border-b border-slate-200 py-0.5 text-slate-700">
        <span>ค่าจัดส่ง / บริการ:</span>
        <span class="font-mono">+฿{{bill.shipping_fee}}</span>
      </div>
      <div class="flex justify-between border-b border-slate-200 py-0.5 text-slate-700">
        <span>ภาษีมูลค่าเพิ่ม (7%):</span>
        <span class="font-mono">+฿{{bill.tax_amount}}</span>
      </div>
      <div class="flex justify-between border-b border-slate-200 py-0.5 text-amber-800 font-bold">
        <span>เงินมัดจำประกัน:</span>
        <span class="font-mono">฿{{bill.deposit_amount}}</span>
      </div>
      <div class="flex justify-between rounded bg-red-700 p-1.5 text-white font-extrabold text-[9.5px] mt-1 shadow-xs">
        <span>ยอดสุทธิรวมทั้งสิ้น:</span>
        <span class="font-mono">฿{{bill.grand_total}}</span>
      </div>
      <div class="flex justify-between py-0.5 text-slate-700 font-semibold pt-1">
        <span>ชำระแล้ว:</span>
        <span class="font-mono text-emerald-700 font-bold">฿{{bill.paid_amount}}</span>
      </div>
      <div class="flex justify-between border-t border-slate-200 py-0.5 text-red-700 font-black">
        <span>คงค้างชำระ:</span>
        <span class="font-mono">฿{{bill.outstanding_amount}}</span>
      </div>
    </div>
  </div>

  ${renderSignatureBox('ลงชื่อ ( {{customer.name}} )', 'ผู้เช่า / ผู้ตรวจรับมอบอุปกรณ์', 'ลงชื่อ ( {{business.authorized_person}} )', '{{business.name}} (ผู้ให้เช่า)')}
</div>
    `.trim()
  },

  // 4. RECEIPT (ใบเสร็จรับเงิน)
  {
    id: 'tpl_receipt',
    name: 'ใบเสร็จรับเงิน (Official Receipt)',
    category: 'ใบเสร็จรับเงิน',
    source: 'BUILTIN',
    fileType: 'HTML',
    version: 1,
    paperSize: 'A4',
    orientation: 'PORTRAIT',
    pageCount: 1,
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    createdBy: 'ระบบ',
    description: 'ใบเสร็จรับเงินทางการ สำหรับยืนยันการรับเงินค่าเช่า/ค่าบริการ พร้อมช่องทางชำระและลายเซ็นแคชเชียร์',
    defaultTerms: '1. ใบเสร็จรับเงินนี้จะสมบูรณ์เมื่อเงินเข้าบัญชีหรือเช็คผ่านการเคลียริ่งเรียบร้อยแล้ว\n2. เอกสารออกโดยระบบคอมพิวเตอร์ถูกต้องตามกฎหมาย',
    templateSchema: `
<div class="box-border flex h-full w-full flex-col justify-between overflow-hidden bg-white px-[10mm] py-[8mm] font-sans text-[9.5px] leading-[1.3] text-slate-900">
  ${renderTemplateHeader('ใบเสร็จรับเงิน / RECEIPT', 'ใบเสร็จรับเงิน')}

  <div class="mb-2 rounded border border-slate-300 bg-slate-50/80 p-2 text-[9px]">
    <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">ได้รับเงินจาก (Received From):</h4>
    <div class="grid grid-cols-2 gap-2">
      <div>
        <p class="font-bold text-slate-900 text-[10px]">{{customer.name}}</p>
        <p class="text-slate-600 truncate">{{customer.address}}</p>
      </div>
      <div>
        <p class="text-slate-600">โทรศัพท์: <span class="font-semibold text-slate-900">{{customer.phone}}</span></p>
        <p class="text-slate-600">เลขประจำตัวผู้เสียภาษี: <span class="font-semibold text-slate-900">{{customer.tax_id}}</span></p>
      </div>
    </div>
  </div>

  ${renderStandard20ItemTable({ col2: 'รายการชำระ / ค่าบริการเช่าอุปกรณ์', col6: 'รอบบิล' })}

  <div class="mb-2 grid grid-cols-12 gap-3 items-start">
    <div class="col-span-7 space-y-1.5">
      <div class="rounded border border-slate-300 bg-slate-50/70 p-2 text-[8px] leading-relaxed text-slate-700">
        <p class="font-extrabold text-red-800 mb-0.5 text-[8.5px]">บันทึกการรับชำระเงิน:</p>
        <p class="whitespace-pre-line">{{document.custom_terms}}</p>
      </div>
      ${renderBankAndQrBox()}
    </div>

    <div class="col-span-5 rounded border border-slate-300 bg-slate-50 p-2 text-[8.5px] space-y-0.5">
      <div class="flex justify-between border-b border-slate-200 py-0.5">
        <span class="text-slate-600">มูลค่าบิลทั้งสิ้น:</span>
        <span class="font-mono font-bold">฿{{bill.grand_total}}</span>
      </div>
      <div class="flex justify-between rounded bg-red-700 p-1.5 text-white font-extrabold text-[9.5px] mt-1 shadow-xs">
        <span>ยอดรับชำระครั้งนี้:</span>
        <span class="font-mono">฿{{bill.paid_amount}}</span>
      </div>
      <div class="flex justify-between border-t border-slate-200 py-0.5 text-slate-700 font-semibold pt-1">
        <span>ช่องทางชำระ:</span>
        <span class="font-bold text-slate-900">{{bill.payment_method}}</span>
      </div>
      <div data-requires-outstanding class="flex justify-between border-t border-slate-200 py-0.5 font-bold">
        <span class="text-slate-700">ยอดคงค้างคงเหลือ:</span>
        <span class="font-mono text-emerald-700">฿{{bill.outstanding_amount}}</span>
      </div>
    </div>
  </div>

  ${renderSignatureBox('ลงชื่อ ( {{customer.name}} )', 'ผู้ชำระเงิน / ลูกค้า', 'ลงชื่อ ( {{business.authorized_person}} )', '{{business.name}} (ผู้รับเงิน/เจ้าหน้าที่การเงิน)')}
</div>
    `.trim()
  },

  // 5. TAX_INVOICE (ใบกำกับภาษี)
  {
    id: 'tpl_tax_invoice',
    name: 'ใบกำกับภาษีเต็มรูป (Full Tax Invoice)',
    category: 'ใบกำกับภาษี',
    source: 'BUILTIN',
    fileType: 'HTML',
    version: 1,
    paperSize: 'A4',
    orientation: 'PORTRAIT',
    pageCount: 1,
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    createdBy: 'ระบบ',
    description: 'ใบกำกับภาษีเต็มรูปตามประมวลรัษฎากร พร้อมข้อมูลสำนักงานใหญ่/สาขา และตาราง 20 บรรทัด',
    defaultTerms: 'เอกสารนี้ออกตามระเบียบกรมสรรพากร สำนักงานใหญ่ / สาขาตามที่ระบุ',
    templateSchema: `
<div class="box-border flex h-full w-full flex-col justify-between overflow-hidden bg-white px-[10mm] py-[8mm] font-sans text-[9.5px] leading-[1.3] text-slate-900">
  ${renderTemplateHeader('ใบกำกับภาษี / TAX INVOICE', 'ใบกำกับภาษี')}

  <div class="mb-2 rounded border border-slate-300 bg-slate-50/80 p-2 text-[9px]">
    <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">ชื่อและที่อยู่ผู้ซื้อสินค้า / ผู้รับบริการ:</h4>
    <div class="grid grid-cols-2 gap-2">
      <div>
        <p class="font-bold text-slate-900 text-[10px]">{{customer.company_name}}</p>
        <p class="text-slate-600 truncate">{{customer.address}}</p>
      </div>
      <div>
        <p class="text-slate-600">เลขประจำตัวผู้เสียภาษีอากร: <span class="font-mono font-bold text-slate-900">{{customer.tax_id}}</span></p>
        <p class="text-slate-600">สาขา: <span class="font-bold text-slate-900">สำนักงานใหญ่ / ตามที่ระบุ</span></p>
      </div>
    </div>
  </div>

  ${renderStandard20ItemTable({ col2: 'รายการสินค้า / บริการเช่า', col6: 'หน่วยภาษี' })}

  <div class="mb-2 grid grid-cols-12 gap-3 items-start">
    <div class="col-span-7 space-y-1.5">
      <div class="rounded border border-slate-300 bg-slate-50/70 p-2 text-[8px] leading-relaxed text-slate-700">
        <p class="font-extrabold text-red-800 mb-0.5 text-[8.5px]">ข้อกำหนดทางภาษีอากร:</p>
        <p>เอกสารนี้ออกถูกต้องตามมาตรา 86/4 แห่งประมวลรัษฎากร</p>
      </div>
      ${renderBankAndQrBox()}
    </div>

    <div class="col-span-5 rounded border border-slate-300 bg-slate-50 p-2 text-[8.5px] space-y-0.5">
      <div class="flex justify-between border-b border-slate-200 py-0.5">
        <span class="text-slate-600">มูลค่าสินค้าก่อนภาษี:</span>
        <span class="font-mono font-bold">฿{{bill.subtotal}}</span>
      </div>
      <div class="flex justify-between border-b border-slate-200 py-0.5 text-slate-700">
        <span>ภาษีมูลค่าเพิ่ม 7%:</span>
        <span class="font-mono font-bold">+฿{{bill.tax_amount}}</span>
      </div>
      <div class="flex justify-between rounded bg-red-700 p-1.5 text-white font-extrabold text-[9.5px] mt-1 shadow-xs">
        <span>จำนวนเงินรวมทั้งสิ้น:</span>
        <span class="font-mono">฿{{bill.grand_total}}</span>
      </div>
    </div>
  </div>

  ${renderSignatureBox('ลงชื่อ ( {{customer.name}} )', 'ผู้รับใบกำกับภาษี', 'ลงชื่อ ( {{business.authorized_person}} )', '{{business.name}} (ผู้มีอำนาจออกใบกำกับภาษี)')}
</div>
    `.trim()
  },

  // 6. RECEIPT_TAX_INVOICE (ใบเสร็จรับเงิน/ใบกำกับภาษี)
  {
    id: 'tpl_receipt_tax_invoice',
    name: 'ใบเสร็จรับเงิน / ใบกำกับภาษี (Receipt & Tax Invoice)',
    category: 'ใบเสร็จรับเงิน/ใบกำกับภาษี',
    source: 'BUILTIN',
    fileType: 'HTML',
    version: 1,
    paperSize: 'A4',
    orientation: 'PORTRAIT',
    pageCount: 1,
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    createdBy: 'ระบบ',
    description: 'เอกสารรวมใบเสร็จรับเงินและใบกำกับภาษีในฉบับเดียว ครบถ้วนตามมาตรฐานกรมสรรพากร',
    defaultTerms: 'ได้รับชำระเงินครบถ้วนตามรายการข้างต้น เอกสารนี้ใช้เป็นหลักฐานภาษีซื้อได้',
    templateSchema: `
<div class="box-border flex h-full w-full flex-col justify-between overflow-hidden bg-white px-[10mm] py-[8mm] font-sans text-[9.5px] leading-[1.3] text-slate-900">
  ${renderTemplateHeader('ใบเสร็จรับเงิน / ใบกำกับภาษี', 'ใบเสร็จรับเงิน/ใบกำกับภาษี')}

  <div class="mb-2 rounded border border-slate-300 bg-slate-50/80 p-2 text-[9px]">
    <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">ลูกค้า / ผู้รับบริการ:</h4>
    <div class="grid grid-cols-2 gap-2">
      <div>
        <p class="font-bold text-slate-900 text-[10px]">{{customer.company_name}}</p>
        <p class="text-slate-600 truncate">{{customer.address}}</p>
      </div>
      <div>
        <p class="text-slate-600">เลขผู้เสียภาษี: <span class="font-mono font-bold text-slate-900">{{customer.tax_id}}</span></p>
        <p class="text-slate-600">โทรศัพท์: <span class="font-semibold text-slate-900">{{customer.phone}}</span></p>
      </div>
    </div>
  </div>

  ${renderStandard20ItemTable({ col2: 'รายการสินค้าและบริการ', col6: 'ประเภท' })}

  <div class="mb-2 grid grid-cols-12 gap-3 items-start">
    <div class="col-span-7 space-y-1.5">
      <div class="rounded border border-slate-300 bg-slate-50/70 p-2 text-[8px] leading-relaxed text-slate-700">
        <p class="font-extrabold text-red-800 mb-0.5 text-[8.5px]">การชำระเงินและภาษี:</p>
        <p>ได้รับชำระเงินถูกต้องเรียบร้อยแล้ว เอกสารมีผลสมบูรณ์ตามกฎหมาย</p>
      </div>
      ${renderBankAndQrBox()}
    </div>

    <div class="col-span-5 rounded border border-slate-300 bg-slate-50 p-2 text-[8.5px] space-y-0.5">
      <div class="flex justify-between border-b border-slate-200 py-0.5">
        <span class="text-slate-600">มูลค่าก่อนภาษี:</span>
        <span class="font-mono font-bold">฿{{bill.subtotal}}</span>
      </div>
      <div class="flex justify-between border-b border-slate-200 py-0.5 text-slate-700">
        <span>ภาษีมูลค่าเพิ่ม (7%):</span>
        <span class="font-mono font-bold">+฿{{bill.tax_amount}}</span>
      </div>
      <div class="flex justify-between rounded bg-red-700 p-1.5 text-white font-extrabold text-[9.5px] mt-1 shadow-xs">
        <span>ยอดรับชำระสุทธิ:</span>
        <span class="font-mono">฿{{bill.grand_total}}</span>
      </div>
    </div>
  </div>

  ${renderSignatureBox('ลงชื่อ ( {{customer.name}} )', 'ผู้ชำระเงิน / ผู้รับใบกำกับ', 'ลงชื่อ ( {{business.authorized_person}} )', '{{business.name}} (ผู้รับเงิน/ผู้ออกเอกสาร)')}
</div>
    `.trim()
  },

  // 7. DELIVERY_NOTE (ใบส่งของ / ใบส่งมอบอุปกรณ์)
  {
    id: 'tpl_delivery_note',
    name: 'ใบส่งมอบอุปกรณ์และตรวจรับสินค้า (Delivery Note)',
    category: 'ใบส่งสินค้า/ติดตั้ง',
    source: 'BUILTIN',
    fileType: 'HTML',
    version: 1,
    paperSize: 'A4',
    orientation: 'PORTRAIT',
    pageCount: 1,
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    createdBy: 'ระบบ',
    description: 'แบบฟอร์มส่งมอบอุปกรณ์ พร้อมตาราง 20 บรรทัดสำหรับระบุจำนวนและรหัสอุปกรณ์',
    defaultTerms: 'ผู้ส่งมอบและผู้รับมอบโปรดตรวจนับจำนวนและสภาพอุปกรณ์ก่อนลงนาม หากพบข้อแตกต่างให้บันทึกหมายเหตุไว้ในเอกสาร',
    templateSchema: `
<div class="box-border flex h-full w-full flex-col justify-between overflow-hidden bg-white px-[10mm] py-[8mm] font-sans text-[9.5px] leading-[1.3] text-slate-900">
  ${renderTemplateHeader('ใบส่งมอบอุปกรณ์ / DELIVERY NOTE', 'ใบส่งสินค้า/ติดตั้ง', 'อ้างอิงบิล')}

  <div class="mb-2 grid grid-cols-2 gap-3 rounded border border-slate-300 bg-slate-50/80 p-2 text-[9px]">
    <div>
      <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">สถานที่ส่งมอบ / ลูกค้าผู้รับ:</h4>
      <p class="whitespace-nowrap font-bold text-slate-900 text-[10px]">{{customer.name}}</p>
      <p class="text-slate-600 truncate">{{document.site_name}}</p>
      <p class="text-slate-600">โทร: <span class="font-semibold text-slate-900">{{customer.phone}}</span></p>
    </div>
    <div>
      <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">รายละเอียดการขนส่ง:</h4>
      <p>วันที่ส่งมอบ: <span class="font-bold text-slate-900">{{document.date}}</span></p>
      <p>กำหนดคืนสินค้า: <span class="font-bold text-slate-900">{{document.rental_end_date}}</span></p>
      <p>พนักงานจัดส่ง: <span class="font-semibold text-slate-800">{{business.authorized_person}}</span></p>
    </div>
  </div>

  <!-- Delivery 20 Rows Table -->
  <div class="mb-2 w-full overflow-hidden">
    <table class="w-full table-fixed border-collapse text-[8.5px] leading-tight border border-slate-400">
      <thead>
        <tr class="bg-slate-900 text-white font-extrabold border-b-2 border-red-700">
          <th class="w-[6%] border border-slate-700 px-1 py-1 text-center">ลำดับ</th>
          <th class="w-[44%] border border-slate-700 px-1.5 py-1 text-left">รายการอุปกรณ์ที่ส่งมอบ</th>
          <th class="w-[10%] border border-slate-700 px-1 py-1 text-center">จำนวน</th>
          <th class="w-[10%] border border-slate-700 px-1 py-1 text-center">หน่วย</th>
          <th class="w-[16%] border border-slate-700 px-1.5 py-1 text-center">จำนวนส่งแล้ว</th>
          <th class="w-[14%] border border-slate-700 px-1.5 py-1 text-left">รหัสอุปกรณ์</th>
        </tr>
      </thead>
      <tbody>
        {{items.rows_delivery_20}}
      </tbody>
    </table>
  </div>

  <div class="mb-2 rounded border border-slate-300 bg-slate-50/70 p-2 text-[8px] leading-relaxed text-slate-700">
    <p class="font-extrabold text-red-800 mb-0.5 text-[8.5px]">เงื่อนไขการตรวจรับมอบอุปกรณ์:</p>
    <p class="whitespace-pre-line">{{document.custom_terms}}</p>
  </div>

  ${renderSignatureBox('ลงชื่อ ( {{customer.name}} )', 'ผู้ตรวจรับมอบสินค้า ณ หน้างาน', 'ลงชื่อ ( {{business.authorized_person}} )', 'พนักงานจัดส่งและทดสอบระบบ')}
</div>
    `.trim()
  },
  {
    id: 'tpl_equipment_check',
    name: 'ใบเช็กของ (ส่ง/เก็บคืน) (Equipment Check)',
    category: 'ใบเช็กของ (ส่ง/เก็บคืน)',
    source: 'BUILTIN',
    fileType: 'HTML',
    version: 1,
    paperSize: 'A4',
    orientation: 'PORTRAIT',
    pageCount: 1,
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    createdBy: 'ระบบ',
    description: 'ตรวจนับจำนวนส่งมอบหรือจำนวนรับคืน โดยอ้างอิงจำนวนจริงจากบิลและไม่กำหนดสภาพสินค้าแทนผู้ตรวจ',
    defaultTerms: 'ตรวจนับรายการและจำนวนตามข้อมูลบิล หากพบจำนวนหรือสภาพสินค้าไม่ตรง ให้บันทึกข้อมูลจริงก่อนลงนาม',
    templateSchema: `
<div class="box-border flex h-full w-full flex-col justify-between overflow-hidden bg-white px-[10mm] py-[8mm] font-sans text-[9.5px] leading-[1.3] text-slate-900">
  ${renderTemplateHeader('ใบเช็กของ / EQUIPMENT CHECK', 'ใบเช็กของ (ส่ง/เก็บคืน)', 'อ้างอิงบิล')}
  <div class="mb-2 grid grid-cols-2 gap-3 rounded border border-slate-300 bg-slate-50/80 p-2 text-[9px]">
    <div>
      <h4 class="font-extrabold text-red-800 mb-0.5 text-[9.5px]">ลูกค้า / สถานที่:</h4>
      <p class="font-bold text-slate-900 text-[10px]">{{customer.name}}</p>
      <p class="text-slate-600">{{document.site_name}}</p>
    </div>
    <div>
      <h4 class="font-extrabold text-red-800 mb-0.5 text-[9.5px]">ขั้นตอนตรวจ:</h4>
      <p class="font-bold">{{document.check_stage}}</p>
      <p>วันที่: <span class="font-bold">{{document.date}}</span></p>
      <p>อ้างอิงบิล: <span class="font-bold">{{bill.no}}</span></p>
    </div>
  </div>
  <div class="mb-2 w-full overflow-hidden">
    <table class="w-full table-fixed border-collapse text-[8.5px] leading-tight border border-slate-400">
      <thead>
        <tr class="bg-slate-900 text-white font-extrabold border-b-2 border-red-700">
          <th class="w-[6%] border border-slate-700 px-1 py-1 text-center">ลำดับ</th>
          <th class="w-[34%] border border-slate-700 px-1.5 py-1 text-left">รายการอุปกรณ์</th>
          <th class="w-[12%] border border-slate-700 px-1 py-1 text-center">{{document.check_col_1}}</th>
          <th class="w-[12%] border border-slate-700 px-1 py-1 text-center">{{document.check_col_2}}</th>
          <th class="w-[12%] border border-slate-700 px-1 py-1 text-center">{{document.check_col_3}}</th>
          <th class="w-[12%] border border-slate-700 px-1 py-1 text-center">{{document.check_col_4}}</th>
          <th class="w-[12%] border border-slate-700 px-1 py-1 text-center">{{document.check_col_5}}</th>
        </tr>
      </thead>
      <tbody>{{items.rows_check_20}}</tbody>
    </table>
  </div>
  <div class="mb-2 rounded border border-slate-300 bg-slate-50/70 p-2 text-[8px] leading-relaxed text-slate-700">
    <p class="font-extrabold text-red-800 mb-0.5 text-[8.5px]">หมายเหตุการตรวจ:</p>
    <p class="whitespace-pre-line">{{document.custom_terms}}</p>
  </div>
  ${renderSignatureBox('ลงชื่อ ( {{customer.name}} )', 'ผู้ตรวจนับ / ผู้รับมอบ', 'ลงชื่อ ( {{business.authorized_person}} )', 'ผู้ส่งมอบ / ผู้รับคืน')}
</div>`.trim()
  },

  // 8. RENTAL_CONTRACT (หนังสือสัญญาเช่าสินค้าและอุปกรณ์)
  {
    id: 'tpl_rental_contract',
    name: 'สัญญาเช่าสินค้าและอุปกรณ์มาตรฐาน (Rental Contract Agreement)',
    category: 'สัญญาเช่าสินค้า',
    source: 'BUILTIN',
    fileType: 'HTML',
    version: 1,
    paperSize: 'A4',
    orientation: 'PORTRAIT',
    pageCount: 1,
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    createdBy: 'ระบบ',
    description: 'สัญญาเช่าทางกฎหมายฉบับสมบูรณ์ พร้อมข้อตกลง 5 ข้อ ตารางทรัพย์สิน 20 แถว และพยาน',
    defaultTerms: '1. ผู้เช่าตกลงดูแลรักษาทรัพย์สินให้อยู่ในสภาพพร้อมใช้งานเสมอ\n2. ห้ามดัดแปลง เคลื่อนย้าย หรือนำทรัพย์สินไปให้ผู้อื่นเช่าช่วงโดยไม่ได้รับอนุญาต\n3. ค่าชำรุดเสียหายคิดตามอัตราอะไหล่แท้ และเงินมัดจำจะคืนให้หลังตรวจรับสภาพสินค้าเรียบร้อย',
    templateSchema: `
<div class="box-border flex h-full w-full flex-col justify-between overflow-hidden bg-white px-[10mm] py-[8mm] font-sans text-[9.5px] leading-[1.3] text-slate-900">
  ${renderTemplateHeader('สัญญาเช่าสินค้าและอุปกรณ์ / RENTAL CONTRACT', 'สัญญาเช่าสินค้า')}

  <div class="mb-2 grid grid-cols-2 gap-3 rounded border border-slate-300 bg-slate-50/80 p-2 text-[9px]">
    <div>
      <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">ผู้เช่า / คู่สัญญา (Lessee):</h4>
      <p class="whitespace-nowrap font-bold text-slate-900 text-[10px]">{{customer.name}}</p>
      <p class="text-slate-600 truncate">บัตรประชาชน: <span class="font-mono font-semibold text-slate-900">{{customer.id_card}}</span></p>
      <p class="text-slate-600 truncate">ที่อยู่: {{customer.address}}</p>
      <p class="text-slate-600">โทรศัพท์: <span class="font-semibold text-slate-900">{{customer.phone}}</span></p>
    </div>
    <div>
      <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">ผู้ให้เช่า (Lessor):</h4>
      <p class="whitespace-nowrap font-bold text-slate-900 text-[10px]">{{business.name}}</p>
      <p class="text-slate-600 truncate">ผู้มีอำนาจลงนาม: {{business.authorized_person}}</p>
      <p class="text-slate-600 truncate">ระยะเวลาสัญญา: {{document.rental_start_date}} ถึง {{document.rental_end_date}}</p>
      <p class="text-slate-600">เงินมัดจำประกันสัญญา: <span class="font-mono font-bold text-red-700">฿{{bill.deposit_amount}}</span></p>
    </div>
  </div>

  ${renderStandard20ItemTable({ col2: 'รายการทรัพย์สินที่เช่าตามสัญญา', col6: 'ระยะเวลาเช่า' })}

  <div class="mb-2 rounded border border-slate-300 bg-slate-50/70 p-2 text-[8px] leading-relaxed text-slate-700">
    <p class="font-extrabold text-red-800 mb-0.5 text-[8.5px]">ข้อตกลงและเงื่อนไขความรับผิดชอบ:</p>
    <p class="whitespace-pre-line">{{document.custom_terms}}</p>
  </div>

  <!-- Dual Signatures + Witnesses -->
  <div class="mt-auto grid grid-cols-2 gap-8 border-t border-slate-300 pt-2 text-center text-[8.5px]">
    <div>
      <div class="mx-auto mb-1 h-6 w-40 border-b border-dashed border-slate-400"></div>
      <p class="font-bold text-slate-900">ลงชื่อ ( {{customer.name}} )</p>
      <p class="text-slate-500 text-[8px]">ผู้เช่า / คู่สัญญา</p>
    </div>
    <div>
      <div class="mx-auto mb-1 h-6 w-40 border-b border-dashed border-slate-400"></div>
      <p class="font-bold text-slate-900">ลงชื่อ ( {{business.authorized_person}} )</p>
      <p class="text-slate-500 text-[8px]">{{business.name}} (ผู้ให้เช่า)</p>
    </div>
  </div>
</div>
    `.trim()
  },

  // 9. RETURN_RECEIPT (ใบรับคืนสินค้า)
  {
    id: 'tpl_return_receipt',
    name: 'ใบรับคืนสินค้าและสรุปการคืน (Equipment Return Slip)',
    category: 'ใบรับคืนสินค้า',
    source: 'BUILTIN',
    fileType: 'HTML',
    version: 1,
    paperSize: 'A4',
    orientation: 'PORTRAIT',
    pageCount: 1,
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    createdBy: 'ระบบ',
    description: 'เอกสารตรวจรับคืนสินค้า บันทึกจำนวนปกติ ชำรุด สูญหาย ค่าปรับ และยอดเงินมัดจำคงเหลือคืนลูกค้า',
    defaultTerms: '1. ตรวจสอบนับจำนวนและสภาพสินค้าเรียบร้อยตามตาราง\n2. ยอดเงินมัดจำคงเหลือจะดำเนินการโอนคืนเข้าบัญชีลูกค้าภายใน 1-3 วันทำการ',
    templateSchema: `
<div class="box-border flex h-full w-full flex-col justify-between overflow-hidden bg-white px-[10mm] py-[8mm] font-sans text-[9.5px] leading-[1.3] text-slate-900">
  ${renderTemplateHeader('ใบรับคืนสินค้า / RETURN SLIP', 'ใบรับคืนสินค้า')}

  <div class="mb-2 grid grid-cols-2 gap-3 rounded border border-slate-300 bg-slate-50/80 p-2 text-[9px]">
    <div>
      <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">ข้อมูลผู้เช่า / ผู้ส่งคืน:</h4>
      <p class="whitespace-nowrap font-bold text-slate-900 text-[10px]">{{customer.name}}</p>
      <p class="text-slate-600 truncate">{{customer.address}}</p>
      <p class="text-slate-600">โทร: <span class="font-semibold text-slate-900">{{customer.phone}}</span></p>
    </div>
    <div>
      <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">ระยะเวลาการเช่าและการคืน:</h4>
      <p>เริ่มเช่า: <span class="font-bold text-slate-900">{{document.rental_start_date}}</span> | กำหนดคืน: <span class="font-bold text-slate-900">{{document.rental_end_date}}</span></p>
      <p>วันที่รับคืนจริง: <span class="font-bold text-slate-900">{{document.date}}</span></p>
    </div>
  </div>

  <!-- Return 20 Rows Table -->
  <div class="mb-2 w-full overflow-hidden">
    <table class="w-full table-fixed border-collapse text-[8.5px] leading-tight border border-slate-400">
      <thead>
        <tr class="bg-slate-900 text-white font-extrabold border-b-2 border-red-700">
          <th class="w-[6%] border border-slate-700 px-1 py-1 text-center">ลำดับ</th>
          <th class="w-[42%] border border-slate-700 px-1.5 py-1 text-left">รายการสินค้า</th>
          <th class="w-[10%] border border-slate-700 px-1 py-1 text-center">คืนแล้ว</th>
          <th class="w-[10%] border border-slate-700 px-1 py-1 text-center text-emerald-300">ปกติ</th>
          <th class="w-[10%] border border-slate-700 px-1 py-1 text-center text-amber-300">ชำรุด</th>
          <th class="w-[10%] border border-slate-700 px-1 py-1 text-center text-red-300">หาย</th>
          <th class="w-[12%] border border-slate-700 px-1.5 py-1 text-right">ค่าเสียหาย</th>
        </tr>
      </thead>
      <tbody>
        {{items.rows_return_20}}
      </tbody>
    </table>
  </div>

  <div class="mb-2 grid grid-cols-12 gap-3 items-start">
    <div class="col-span-7 space-y-1.5">
      <div class="rounded border border-slate-300 bg-slate-50/70 p-2 text-[8px] leading-relaxed text-slate-700">
        <p class="font-extrabold text-red-800 mb-0.5 text-[8.5px]">บันทึกการตรวจสอบสภาพสินค้า:</p>
        <p class="whitespace-pre-line">{{document.custom_terms}}</p>
      </div>
      ${renderBankAndQrBox()}
    </div>

    <div class="col-span-5 rounded border border-slate-300 bg-slate-50 p-2 text-[8.5px] space-y-0.5">
      <div class="flex justify-between border-b border-slate-200 py-0.5">
        <span class="text-slate-600">ค่าปรับส่งคืนล่าช้า:</span>
        <span class="font-mono font-semibold text-red-700">฿{{bill.late_fee}}</span>
      </div>
      <div class="flex justify-between border-b border-slate-200 py-0.5">
        <span class="text-slate-600">ค่าชำรุด / สูญหาย:</span>
        <span class="font-mono font-semibold text-amber-800">฿{{bill.damage_fee}}</span>
      </div>
      <div class="flex justify-between rounded bg-red-700 p-1.5 text-white font-extrabold text-[9.5px] mt-1 shadow-xs">
        <span>ยอดเงินมัดจำคืนสุทธิ:</span>
        <span class="font-mono">฿{{bill.refund_amount}}</span>
      </div>
    </div>
  </div>

  ${renderSignatureBox('ลงชื่อ ( {{customer.name}} )', 'ผู้ส่งคืนสินค้า / ผู้เช่า', 'ลงชื่อ ( {{business.authorized_person}} )', 'เจ้าหน้าที่ตรวจสอบรับคืนสินค้า')}
</div>
    `.trim()
  },

  // 10. PAYMENT_RECEIPT (ใบเสร็จรับเงินค่าเช่า / ค่างวด)
  {
    id: 'tpl_payment_receipt',
    name: 'ใบเสร็จรับเงินค่าเช่า / ค่างวด (Payment Installment Receipt)',
    category: 'ใบเสร็จรับเงิน',
    source: 'BUILTIN',
    fileType: 'HTML',
    version: 1,
    paperSize: 'A4',
    orientation: 'PORTRAIT',
    pageCount: 1,
    isDefault: false,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    createdBy: 'ระบบ',
    description: 'ใบเสร็จรับเงินสำหรับการแบ่งชำระเป็นงวดๆ หรือชำระค่าบริการส่วนเพิ่มระหว่างสัญญา',
    defaultTerms: 'ได้รับชำระเงินค่างวด/ค่าบริการตามบิลสัญญาเรียบร้อยแล้ว',
    templateSchema: `
<div class="box-border flex h-full w-full flex-col justify-between overflow-hidden bg-white px-[10mm] py-[8mm] font-sans text-[9.5px] leading-[1.3] text-slate-900">
  ${renderTemplateHeader('ใบเสร็จรับเงินค่างวด / INSTALLMENT RECEIPT', 'ใบเสร็จรับเงิน')}

  <div class="mb-2 rounded border border-slate-300 bg-slate-50/80 p-2 text-[9px]">
    <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">ได้รับชำระจาก (Payer):</h4>
    <div class="grid grid-cols-2 gap-2">
      <div>
        <p class="font-bold text-slate-900 text-[10px]">{{customer.name}}</p>
        <p class="text-slate-600 truncate">{{customer.address}}</p>
      </div>
      <div>
        <p class="text-slate-600">โทรศัพท์: <span class="font-semibold text-slate-900">{{customer.phone}}</span></p>
        <p class="text-slate-600">อ้างอิงบิลเช่าเลขที่: <span class="font-mono font-bold text-slate-900">{{bill.no}}</span></p>
      </div>
    </div>
  </div>

  ${renderStandard20ItemTable({ col2: 'รายละเอียดงวดชำระ / ค่าบริการ', col6: 'งวดที่' })}

  <div class="mb-2 grid grid-cols-12 gap-3 items-start">
    <div class="col-span-7 space-y-1.5">
      <div class="rounded border border-slate-300 bg-slate-50/70 p-2 text-[8px] leading-relaxed text-slate-700">
        <p class="font-extrabold text-red-800 mb-0.5 text-[8.5px]">หมายเหตุ:</p>
        <p class="whitespace-pre-line">{{document.custom_terms}}</p>
      </div>
      ${renderBankAndQrBox()}
    </div>

    <div class="col-span-5 rounded border border-slate-300 bg-slate-50 p-2 text-[8.5px] space-y-0.5">
      <div class="flex justify-between border-b border-slate-200 py-0.5">
        <span class="text-slate-600">มูลค่ารวมทั้งสัญญา:</span>
        <span class="font-mono font-bold">฿{{bill.grand_total}}</span>
      </div>
      <div class="flex justify-between rounded bg-red-700 p-1.5 text-white font-extrabold text-[9.5px] mt-1 shadow-xs">
        <span>ยอดชำระงวดนี้:</span>
        <span class="font-mono">฿{{bill.paid_amount}}</span>
      </div>
      <div class="flex justify-between border-t border-slate-200 py-0.5 font-bold">
        <span class="text-slate-700">ยอดคงค้างคงเหลือ:</span>
        <span class="font-mono text-red-700">฿{{bill.outstanding_amount}}</span>
      </div>
    </div>
  </div>

  ${renderSignatureBox('ลงชื่อ ( {{customer.name}} )', 'ผู้ชำระเงิน', 'ลงชื่อ ( {{business.authorized_person}} )', '{{business.name}} (ผู้รับเงิน)')}
</div>
    `.trim()
  },

  // 11. DEPOSIT_RECEIPT (ใบรับเงินมัดจำ / ประกันสินค้า)
  {
    id: 'tpl_deposit_receipt',
    name: 'ใบรับเงินมัดจำประกันสินค้า (Security Deposit Receipt)',
    category: 'ใบรับเงินมัดจำ',
    source: 'BUILTIN',
    fileType: 'HTML',
    version: 1,
    paperSize: 'A4',
    orientation: 'PORTRAIT',
    pageCount: 1,
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    createdBy: 'ระบบ',
    description: 'เอกสารสำคัญแสดงการถือครองเงินมัดจำประกันความเสียหาย พร้อมเงื่อนไขการคืนเงิน 100%',
    defaultTerms: '1. เงินมัดจำประกันนี้ไม่ใช่ค่าเช่า และจะคืนให้เต็มจำนวนเมื่อคืนสินค้าในสภาพปกติครบถ้วน\n2. กรณีมีค่าชำรุด สูญหาย หรือส่งคืนเกินกำหนด ผู้ให้เช่ามีสิทธิ์หักค่าใช้จ่ายจากเงินมัดจำนี้',
    templateSchema: `
<div class="box-border flex h-full w-full flex-col justify-between overflow-hidden bg-white px-[10mm] py-[8mm] font-sans text-[9.5px] leading-[1.3] text-slate-900">
  ${renderTemplateHeader('ใบรับเงินมัดจำประกัน / DEPOSIT RECEIPT', 'ใบรับเงินมัดจำ')}

  <div class="mb-2 rounded border border-slate-300 bg-slate-50/80 p-2 text-[9px]">
    <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">ได้รับเงินมัดจำจาก (Depositor):</h4>
    <div class="grid grid-cols-2 gap-2">
      <div>
        <p class="font-bold text-slate-900 text-[10px]">{{customer.name}}</p>
        <p class="text-slate-600 truncate">{{customer.address}}</p>
      </div>
      <div>
        <p class="text-slate-600">โทรศัพท์: <span class="font-semibold text-slate-900">{{customer.phone}}</span></p>
        <p class="text-slate-600">อ้างอิงสัญญาเช่าเลขที่: <span class="font-mono font-bold text-slate-900">{{document.number}}</span></p>
      </div>
    </div>
  </div>

  ${renderStandard20ItemTable({ col2: 'รายการอุปกรณ์ที่วางเงินประกันมัดจำ', col6: 'ประเภทมัดจำ' })}

  <div class="mb-2 grid grid-cols-12 gap-3 items-start">
    <div class="col-span-7 space-y-1.5">
      <div class="rounded border border-slate-300 bg-slate-50/70 p-2 text-[8px] leading-relaxed text-slate-700">
        <p class="font-extrabold text-red-800 mb-0.5 text-[8.5px]">เงื่อนไขการถือครองและการคืนเงินมัดจำ:</p>
        <p class="whitespace-pre-line">{{document.custom_terms}}</p>
      </div>
      ${renderBankAndQrBox()}
    </div>

    <div class="col-span-5 rounded border border-slate-300 bg-slate-50 p-2 text-[8.5px] space-y-0.5">
      <div class="flex justify-between rounded bg-red-700 p-2 text-white font-black text-[11px] shadow-xs">
        <span>จำนวนเงินมัดจำที่รับไว้:</span>
        <span class="font-mono">฿{{bill.deposit_amount}}</span>
      </div>
      <p class="text-slate-500 text-[8px] text-center pt-1">สถานะ: ถือครองในระบบรอการคืนเมื่อสิ้นสุดสัญญา</p>
    </div>
  </div>

  ${renderSignatureBox('ลงชื่อ ( {{customer.name}} )', 'ผู้วางเงินมัดจำประกัน', 'ลงชื่อ ( {{business.authorized_person}} )', '{{business.name}} (ผู้รับถือครองเงินมัดจำ)')}
</div>
    `.trim()
  },

  // 12. REFUND_RECEIPT (ใบสำคัญจ่ายคืนเงินมัดจำ)
  {
    id: 'tpl_refund_receipt',
    name: 'ใบสำคัญจ่ายคืนเงินมัดจำ (Deposit Refund Voucher)',
    category: 'ใบสำคัญจ่าย',
    source: 'BUILTIN',
    fileType: 'HTML',
    version: 1,
    paperSize: 'A4',
    orientation: 'PORTRAIT',
    pageCount: 1,
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    createdBy: 'ระบบ',
    description: 'ใบสำคัญจ่ายสำหรับฝ่ายบัญชี บันทึกการจ่ายคืนเงินมัดจำหลังหักกลบลบหนี้เรียบร้อย',
    defaultTerms: 'ผู้รับเงินได้รับเงินมัดจำคืนถูกต้องครบถ้วนแล้ว และตกลงไม่เรียกร้องสิทธิ์ใดๆ เพิ่มเติม',
    templateSchema: `
<div class="box-border flex h-full w-full flex-col justify-between overflow-hidden bg-white px-[10mm] py-[8mm] font-sans text-[9.5px] leading-[1.3] text-slate-900">
  ${renderTemplateHeader('ใบสำคัญจ่ายคืนเงินมัดจำ / REFUND VOUCHER', 'ใบสำคัญจ่าย')}

  <div class="mb-2 rounded border border-slate-300 bg-slate-50/80 p-2 text-[9px]">
    <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">จ่ายเงินคืนให้แก่ (Payee):</h4>
    <div class="grid grid-cols-2 gap-2">
      <div>
        <p class="font-bold text-slate-900 text-[10px]">{{customer.name}}</p>
        <p class="text-slate-600 truncate">{{customer.address}}</p>
      </div>
      <div>
        <p class="text-slate-600">โทรศัพท์: <span class="font-semibold text-slate-900">{{customer.phone}}</span></p>
        <p class="text-slate-600">อ้างอิงบิลเช่าเลขที่: <span class="font-mono font-bold text-slate-900">{{bill.no}}</span></p>
      </div>
    </div>
  </div>

  ${renderStandard20ItemTable({ col2: 'รายการแจกแจงการคืนเงินมัดจำและหักชดใช้', col6: 'สถานะ' })}

  <div class="mb-2 grid grid-cols-12 gap-3 items-start">
    <div class="col-span-7 space-y-1.5">
      <div class="rounded border border-slate-300 bg-slate-50/70 p-2 text-[8px] leading-relaxed text-slate-700">
        <p class="font-extrabold text-red-800 mb-0.5 text-[8.5px]">ข้อความการรับเงินคืน:</p>
        <p class="whitespace-pre-line">{{document.custom_terms}}</p>
      </div>
    </div>

    <div class="col-span-5 rounded border border-slate-300 bg-slate-50 p-2 text-[8.5px] space-y-0.5">
      <div class="flex justify-between border-b border-slate-200 py-0.5">
        <span class="text-slate-600">เงินมัดจำตั้งต้น:</span>
        <span class="font-mono font-bold">฿{{bill.deposit_amount}}</span>
      </div>
      <div class="flex justify-between border-b border-slate-200 py-0.5 text-red-700 font-bold">
        <span>หักค่าปรับ/ค่าชำรุด:</span>
        <span class="font-mono">-฿{{bill.damage_fee}}</span>
      </div>
      <div class="flex justify-between rounded bg-red-700 p-1.5 text-white font-extrabold text-[9.5px] mt-1 shadow-xs">
        <span>ยอดเงินโอนคืนสุทธิ:</span>
        <span class="font-mono">฿{{bill.refund_amount}}</span>
      </div>
    </div>
  </div>

  ${renderSignatureBox('ลงชื่อ ( {{customer.name}} )', 'ผู้รับเงินคืน / ผู้เช่า', 'ลงชื่อ ( {{business.authorized_person}} )', '{{business.name}} (ผู้อนุมัติจ่ายเงิน)')}
</div>
    `.trim()
  },

  // 13. STATEMENT (ใบแจ้งยอดสรุปบัญชีลูกหนี้)
  {
    id: 'tpl_statement',
    name: 'ใบแจ้งยอดสรุปบัญชีลูกหนี้ (Statement of Account)',
    category: 'สเตทเมนต์',
    source: 'BUILTIN',
    fileType: 'HTML',
    version: 1,
    paperSize: 'A4',
    orientation: 'PORTRAIT',
    pageCount: 1,
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    createdBy: 'ระบบ',
    description: 'สเตทเมนต์สรุปยอดบิลค้างชำระ ยอดชำระสะสม และยอดคงเหลือรวมของลูกค้ารายบุคคล/บริษัท',
    defaultTerms: 'กรุณาชำระยอดเงินคงค้างภายใน 7 วันทำการ นับจากวันที่ในใบแจ้งยอดนี้',
    templateSchema: `
<div class="box-border flex h-full w-full flex-col justify-between overflow-hidden bg-white px-[10mm] py-[8mm] font-sans text-[9.5px] leading-[1.3] text-slate-900">
  ${renderTemplateHeader('ใบแจ้งยอดบัญชี / STATEMENT', 'สเตทเมนต์')}

  <div class="mb-2 grid grid-cols-2 gap-3 rounded border border-slate-300 bg-slate-50/80 p-2 text-[9px]">
    <div>
      <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">ชื่อลูกหนี้ / บริษัท (Account):</h4>
      <p class="whitespace-nowrap font-bold text-slate-900 text-[10px]">{{customer.name}}</p>
      <p class="text-slate-600 truncate">{{customer.company_name}}</p>
      <p class="text-slate-600 truncate">{{customer.address}}</p>
    </div>
    <div>
      <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">สรุปบัญชีประจำงวด:</h4>
      <p>รหัสลูกค้า: <span class="font-mono font-bold text-slate-900">{{customer.code}}</span></p>
      <p>วันที่พิมพ์สรุปยอด: <span class="font-bold text-slate-900">{{document.date}}</span></p>
      <p>โทรศัพท์ติดต่อ: <span class="font-semibold text-slate-900">{{customer.phone}}</span></p>
    </div>
  </div>

  <!-- Statement 20 Rows Table -->
  <div class="mb-2 w-full overflow-hidden">
    <table class="w-full table-fixed border-collapse text-[8.5px] leading-tight border border-slate-400">
      <thead>
        <tr class="bg-slate-900 text-white font-extrabold border-b-2 border-red-700">
          <th class="w-[6%] border border-slate-700 px-1 py-1 text-center">ลำดับ</th>
          <th class="w-[18%] border border-slate-700 px-1.5 py-1 text-center">เลขที่เอกสาร</th>
          <th class="w-[34%] border border-slate-700 px-1.5 py-1 text-left">รายละเอียดธุรกรรม</th>
          <th class="w-[14%] border border-slate-700 px-1.5 py-1 text-right">ยอดตั้งหนี้</th>
          <th class="w-[14%] border border-slate-700 px-1.5 py-1 text-right">ยอดชำระแล้ว</th>
          <th class="w-[14%] border border-slate-700 px-1.5 py-1 text-right">ยอดคงค้าง</th>
        </tr>
      </thead>
      <tbody>
        {{items.rows_statement_20}}
      </tbody>
    </table>
  </div>

  <div class="mb-2 grid grid-cols-12 gap-3 items-start">
    <div class="col-span-7 space-y-1.5">
      <div class="rounded border border-slate-300 bg-slate-50/70 p-2 text-[8px] leading-relaxed text-slate-700">
        <p class="font-extrabold text-red-800 mb-0.5 text-[8.5px]">เงื่อนไขการชำระเงินตามสเตทเมนต์:</p>
        <p class="whitespace-pre-line">{{document.custom_terms}}</p>
      </div>
      ${renderBankAndQrBox()}
    </div>

    <div class="col-span-5 rounded border border-slate-300 bg-slate-50 p-2 text-[8.5px] space-y-0.5">
      <div class="flex justify-between border-b border-slate-200 py-0.5">
        <span class="text-slate-600">ยอดหนี้รวมทั้งหมด:</span>
        <span class="font-mono font-bold">฿{{bill.grand_total}}</span>
      </div>
      <div class="flex justify-between border-b border-slate-200 py-0.5 text-emerald-700 font-bold">
        <span>ยอดชำระสะสม:</span>
        <span class="font-mono">฿{{bill.paid_amount}}</span>
      </div>
      <div class="flex justify-between rounded bg-red-700 p-1.5 text-white font-extrabold text-[9.5px] mt-1 shadow-xs">
        <span>ยอดหนี้คงค้างสุทธิ:</span>
        <span class="font-mono">฿{{bill.outstanding_amount}}</span>
      </div>
    </div>
  </div>

  ${renderSignatureBox('ลงชื่อ ( {{customer.name}} )', 'ผู้รับทราบยอดค้างชำระ', 'ลงชื่อ ( {{business.authorized_person}} )', 'ฝ่ายบัญชีและการเงิน')}
</div>
    `.trim()
  },

  // 14. DAMAGE_RECEIPT (ใบเสร็จรับเงินค่าปรับชำรุด/สูญหาย)
  {
    id: 'tpl_damage_receipt',
    name: 'ใบเสร็จรับเงินค่าปรับชำรุด/สูญหาย (Damage & Loss Receipt)',
    category: 'ใบเสร็จค่าชำรุด',
    source: 'BUILTIN',
    fileType: 'HTML',
    version: 1,
    paperSize: 'A4',
    orientation: 'PORTRAIT',
    pageCount: 1,
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    createdBy: 'ระบบ',
    description: 'ใบเสร็จรับเงินเฉพาะสำหรับค่าซ่อมแซม ค่าชดใช้ความเสียหาย และค่าอุปกรณ์สูญหาย',
    defaultTerms: 'ได้รับชำระค่าชดใช้ความเสียหาย/สูญหายเรียบร้อยแล้ว และถือว่าสิ้นสุดภาระความรับผิดชอบในส่วนนี้',
    templateSchema: `
<div class="box-border flex h-full w-full flex-col justify-between overflow-hidden bg-white px-[10mm] py-[8mm] font-sans text-[9.5px] leading-[1.3] text-slate-900">
  ${renderTemplateHeader('ใบเสร็จรับเงินค่าชำรุด/สูญหาย', 'ใบเสร็จค่าชำรุด')}

  <div class="mb-2 rounded border border-slate-300 bg-slate-50/80 p-2 text-[9px]">
    <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">ได้รับเงินจาก (Customer):</h4>
    <div class="grid grid-cols-2 gap-2">
      <div>
        <p class="font-bold text-slate-900 text-[10px]">{{customer.name}}</p>
        <p class="text-slate-600 truncate">{{customer.address}}</p>
      </div>
      <div>
        <p class="text-slate-600">โทรศัพท์: <span class="font-semibold text-slate-900">{{customer.phone}}</span></p>
        <p class="text-slate-600">อ้างอิงบิลเช่าเลขที่: <span class="font-mono font-bold text-slate-900">{{bill.no}}</span></p>
      </div>
    </div>
  </div>

  ${renderStandard20ItemTable({ col2: 'รายการอุปกรณ์ชำรุด / สูญหาย', col6: 'ประเภท' })}

  <div class="mb-2 grid grid-cols-12 gap-3 items-start">
    <div class="col-span-7 space-y-1.5">
      <div class="rounded border border-slate-300 bg-slate-50/70 p-2 text-[8px] leading-relaxed text-slate-700">
        <p class="font-extrabold text-red-800 mb-0.5 text-[8.5px]">บันทึกการชดใช้ความเสียหาย:</p>
        <p class="whitespace-pre-line">{{document.custom_terms}}</p>
      </div>
      ${renderBankAndQrBox()}
    </div>

    <div class="col-span-5 rounded border border-slate-300 bg-slate-50 p-2 text-[8.5px] space-y-0.5">
      <div class="flex justify-between rounded bg-red-700 p-2 text-white font-black text-[11px] shadow-xs">
        <span>ยอดรับชำระค่าเสียหาย:</span>
        <span class="font-mono">฿{{bill.damage_fee}}</span>
      </div>
      <p class="text-slate-500 text-[8px] text-center pt-1">สถานะ: ชำระครบถ้วน ปิดยอดความเสียหาย</p>
    </div>
  </div>

  ${renderSignatureBox('ลงชื่อ ( {{customer.name}} )', 'ผู้ชำระค่าชำรุดเสียหาย', 'ลงชื่อ ( {{business.authorized_person}} )', '{{business.name}} (เจ้าหน้าที่ตรวจรับและรับเงิน)')}
</div>
    `.trim()
  },

  // 15. DAMAGE_INVOICE (ใบแจ้งหนี้ค่าชำรุดเสียหาย)
  {
    id: 'tpl_damage_invoice',
    name: 'ใบแจ้งหนี้ค่าชำรุดเสียหาย (Damage & Repair Invoice)',
    category: 'ใบแจ้งหนี้ค่าชำรุด',
    source: 'BUILTIN',
    fileType: 'HTML',
    version: 1,
    paperSize: 'A4',
    orientation: 'PORTRAIT',
    pageCount: 1,
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    createdBy: 'ระบบ',
    description: 'เอกสารแจ้งประเมินราคาค่าซ่อมและค่าทดแทนอุปกรณ์ชำรุด ก่อนดำเนินการเก็บเงิน',
    defaultTerms: 'กรุณาชำระค่าชดใช้ความเสียหายตามใบแจ้งนี้ภายใน 3 วันทำการ',
    templateSchema: `
<div class="box-border flex h-full w-full flex-col justify-between overflow-hidden bg-white px-[10mm] py-[8mm] font-sans text-[9.5px] leading-[1.3] text-slate-900">
  ${renderTemplateHeader('ใบแจ้งหนี้ค่าชำรุดเสียหาย / DAMAGE INVOICE', 'ใบแจ้งหนี้ค่าชำรุด')}

  <div class="mb-2 rounded border border-slate-300 bg-slate-50/80 p-2 text-[9px]">
    <h4 class="font-extrabold text-red-800 uppercase mb-0.5 text-[9.5px]">แจ้งถึงผู้เช่า (Customer):</h4>
    <div class="grid grid-cols-2 gap-2">
      <div>
        <p class="font-bold text-slate-900 text-[10px]">{{customer.name}}</p>
        <p class="text-slate-600 truncate">{{customer.address}}</p>
      </div>
      <div>
        <p class="text-slate-600">โทรศัพท์: <span class="font-semibold text-slate-900">{{customer.phone}}</span></p>
        <p class="text-slate-600">อ้างอิงบิลเช่าเลขที่: <span class="font-mono font-bold text-slate-900">{{bill.no}}</span></p>
      </div>
    </div>
  </div>

  ${renderStandard20ItemTable({ col2: 'รายการประเมินค่าซ่อมและชิ้นส่วนชำรุด', col6: 'ระดับชำรุด' })}

  <div class="mb-2 grid grid-cols-12 gap-3 items-start">
    <div class="col-span-7 space-y-1.5">
      <div class="rounded border border-slate-300 bg-slate-50/70 p-2 text-[8px] leading-relaxed text-slate-700">
        <p class="font-extrabold text-red-800 mb-0.5 text-[8.5px]">บันทึกการประเมินค่าซ่อม:</p>
        <p class="whitespace-pre-line">{{document.custom_terms}}</p>
      </div>
      ${renderBankAndQrBox()}
    </div>

    <div class="col-span-5 rounded border border-slate-300 bg-slate-50 p-2 text-[8.5px] space-y-0.5">
      <div class="flex justify-between rounded bg-red-700 p-2 text-white font-black text-[11px] shadow-xs">
        <span>ยอดรวมค่าชดใช้ที่ต้องชำระ:</span>
        <span class="font-mono">฿{{bill.damage_fee}}</span>
      </div>
      <p class="text-slate-500 text-[8px] text-center pt-1">กำหนดชำระภายใน 3 วันทำการ</p>
    </div>
  </div>

  ${renderSignatureBox('ลงชื่อ ( {{customer.name}} )', 'ผู้รับทราบยอดประเมินความเสียหาย', 'ลงชื่อ ( {{business.authorized_person}} )', 'วิศวกร/หัวหน้าฝ่ายซ่อมบำรุง')}
</div>
    `.trim()
  },

  // 16. POWER_OF_ATTORNEY (หนังสือมอบอำนาจ)
  {
    id: 'tpl_power_of_attorney',
    name: 'หนังสือมอบอำนาจดำเนินกิจการ (Power of Attorney)',
    category: 'หนังสือมอบอำนาจ',
    source: 'BUILTIN',
    fileType: 'HTML',
    version: 1,
    paperSize: 'A4',
    orientation: 'PORTRAIT',
    pageCount: 1,
    isDefault: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    createdBy: 'ระบบ',
    description: 'หนังสือมอบอำนาจตามกฎหมาย สำหรับตัวแทนในการติดต่อ เช่า รับมอบ และคืนอุปกรณ์แทน',
    defaultTerms: 'ขอมอบอำนาจให้ผู้ถือหนังสือฉบับนี้ มีอำนาจลงนามในสัญญาเช่า ตรวจรับมอบอุปกรณ์ และดำเนินการแทนข้าพเจ้าทุกประการจนเสร็จสิ้น',
    templateSchema: `
<div class="box-border flex h-full w-full flex-col justify-between overflow-hidden bg-white px-[10mm] py-[8mm] font-sans text-[9.5px] leading-[1.3] text-slate-900">
  ${renderTemplateHeader('หนังสือมอบอำนาจ / POWER OF ATTORNEY', 'หนังสือมอบอำนาจ')}

  <div class="space-y-2 rounded border border-slate-300 bg-slate-50/80 p-2.5 text-[9px] leading-relaxed">
    <p>
      โดยหนังสือฉบับนี้ ข้าพเจ้า <span class="font-bold underline text-slate-900">{{customer.name}}</span> 
      ถือบัตรประชาชนเลขที่ <span class="font-mono font-bold text-slate-900">{{customer.id_card}}</span>
      อยู่บ้านเลขที่ / สำนักงาน: <span class="font-semibold">{{customer.address}}</span>
      โทรศัพท์ <span class="font-mono font-bold">{{customer.phone}}</span>
    </p>
    <p class="pt-0.5">
      ขอมอบอำนาจให้ผู้ถือหนังสือฉบับนี้ เป็นตัวแทนผู้มีอำนาจเต็ม ในการดำเนินการติดต่อ ลงนามในสัญญาเช่า ส่งมอบ-ตรวจรับอุปกรณ์ และจัดการธุรกรรมเกี่ยวกับทรัพย์สินรายการต่อไปนี้ กับ <span class="font-bold text-red-800">{{business.name}}</span>
    </p>
  </div>

  ${renderStandard20ItemTable({ col2: 'รายการอุปกรณ์และทรัพย์สินที่มอบอำนาจดำเนินกิจการ', col6: 'ขอบเขต' })}

  <div class="mb-2 rounded border border-slate-300 bg-slate-50/70 p-2 text-[8px] leading-relaxed text-slate-700">
    <p class="font-extrabold text-red-800 mb-0.5 text-[8.5px]">ขอบเขตและเงื่อนไขการมอบอำนาจ:</p>
    <p class="whitespace-pre-line">{{document.custom_terms}}</p>
  </div>

  <!-- Signatures: Grantor, Grantee, Witnesses -->
  <div class="mt-auto grid grid-cols-2 gap-6 border-t border-slate-300 pt-2 text-center text-[8.5px]">
    <div>
      <div class="mx-auto mb-1 h-6 w-36 border-b border-dashed border-slate-400"></div>
      <p class="font-bold text-slate-900">ลงชื่อ ( {{customer.name}} )</p>
      <p class="text-slate-500 text-[8px]">ผู้มอบอำนาจ (Grantor)</p>
      <p class="text-slate-400 text-[7.5px]">วันที่ _____/_____/_________</p>
    </div>
    <div>
      <div class="mx-auto mb-1 h-6 w-36 border-b border-dashed border-slate-400"></div>
      <p class="font-bold text-slate-900">ลงชื่อ ( ___________________ )</p>
      <p class="text-slate-500 text-[8px]">ผู้รับมอบอำนาจ (Attorney-in-Fact)</p>
      <p class="text-slate-400 text-[7.5px]">วันที่ _____/_____/_________</p>
    </div>
  </div>
</div>
    `.trim()
  }
]
