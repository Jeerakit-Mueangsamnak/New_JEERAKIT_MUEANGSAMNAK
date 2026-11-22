/** Adapted from the user's Cloudflare id-card-ocr Worker; no R2/D1 or second UI. */
export const THAI_ID_CLAIRIC_FIELDS = {
  doc_type: { type: 'enum', values: ['thai_id_card', 'other'], instructions: 'Thai national ID card front versus other image' },
  id_number: { type: 'text', instructions: '13-digit Thai national ID number, preserve all digits' },
  prefix: { type: 'text', instructions: 'Thai title นาย นาง นางสาว เด็กชาย เด็กหญิง as printed' },
  first_name: { type: 'text', instructions: 'Given name in Thai script only' },
  last_name: { type: 'text', instructions: 'Family name in Thai script only' },
  address: { type: 'text', instructions: 'Full Thai address exactly as printed on the card front; include province/district/subdistrict labels' },
  house_no: { type: 'text', instructions: 'House number in Thai address, e.g. 12/3' },
  moo: { type: 'text', instructions: 'Village number (หมู่ที่) digits only, if printed' },
  soi: { type: 'text', instructions: 'Soi name/number as printed, if present' },
  road: { type: 'text', instructions: 'Road name (ถนน) as printed, if present' },
  sub_district: { type: 'text', instructions: 'Thai ตำบล or แขวง name only, if printed' },
  district: { type: 'text', instructions: 'Thai อำเภอ or เขต name only, if printed' },
  province: { type: 'text', instructions: 'Thai จังหวัด name only, if printed' },
  birth_date: { type: 'date', instructions: 'Birth date printed on the Thai ID card' },
  expiry_date: { type: 'date', instructions: 'Card expiration date, not the birth or issue date' },
}
