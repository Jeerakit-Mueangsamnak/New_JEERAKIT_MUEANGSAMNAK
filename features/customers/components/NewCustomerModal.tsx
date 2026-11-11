'use client'
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { User, Check, Camera, ShieldCheck, CheckCircle2, AlertTriangle, Trash2, Upload, RefreshCw } from 'lucide-react'
import { Customer } from '@/lib/types/rental-pos'
import type { ThaiProvince } from '@/lib/thai-address-data'
import { IDCardScannerModal, ExtractedIDCardData } from './IDCardScannerModal'
import { ID_CARD_PHOTO_ACCEPT, readIdCardPhotoFile, scanIdCardPhoto } from '@/features/customers/services/id-card-ocr'
import { CustomSelect } from '@/components/common/CustomSelect'
import { AppModal, AppModalHeader, AppModalBody, AppModalFooter } from '@/components/common/AppModal'
import { ModalPortal } from '@/components/common/ModalPortal'
import { validateThaiNationalId, formatThaiNationalId, type ParsedThaiIdField } from '@/lib/ocr/thai-id-parser'
import { formatPhoneNumber } from '@/lib/utils/format'

interface NewCustomerModalProps {
  isOpen: boolean
  onClose: () => void
  /** Resolve false to keep the form open (save failed / cancelled). */
  onSave: (customer: Customer, reason?: string) => Promise<boolean | void> | boolean | void
  editingCustomer?: Customer | null
}

const OCR_FIELD_LABELS: Record<ParsedThaiIdField, string> = {
  name: 'ชื่อ-นามสกุล',
  idCardNumber: 'เลขบัตร',
  birthDate: 'วันเกิด',
  idCardExpiry: 'วันหมดอายุบัตร',
  houseNo: 'บ้านเลขที่',
  moo: 'หมู่',
  soi: 'ซอย',
  road: 'ถนน',
  subDistrict: 'ตำบล',
  district: 'อำเภอ',
  province: 'จังหวัด',
}

export function NewCustomerModal({
  isOpen,
  onClose,
  onSave,
  editingCustomer,
}: NewCustomerModalProps) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [phone2, setPhone2] = useState('')
  const [email, setEmail] = useState('')
  const [lineId, setLineId] = useState('')

  // Separate Thai Address Fields
  const [houseNo, setHouseNo] = useState('')
  const [moo, setMoo] = useState('')
  const [soi, setSoi] = useState('')
  const [road, setRoad] = useState('')
  const [selectedProvince, setSelectedProvince] = useState('')
  const [selectedDistrict, setSelectedDistrict] = useState('')
  const [selectedSubDistrict, setSelectedSubDistrict] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [thaiAddressData, setThaiAddressData] = useState<ThaiProvince[]>([])
  const [thaiProvinceOptions, setThaiProvinceOptions] = useState<string[]>([])
  const [isLoadingThaiAddresses, setIsLoadingThaiAddresses] = useState(false)
  const [thaiAddressLoadError, setThaiAddressLoadError] = useState<string | null>(null)

  // ID Card Fields
  const [idCardNumber, setIdCardNumber] = useState('')
  const [idCardExpiry, setIdCardExpiry] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [idCardImageUrl, setIdCardImageUrl] = useState('')
  const [uploadedFileName, setUploadedFileName] = useState('')
  // Fields the ID card OCR filled in this session: highlighted, and the user must confirm them before saving.
  const [ocrFilled, setOcrFilled] = useState<ParsedThaiIdField[]>([])
  const [ocrMissing, setOcrMissing] = useState<ParsedThaiIdField[]>([])
  // Read but not provable (name, house no …): shown for the user to accept one by one, never filled by itself.
  const [ocrSuggestions, setOcrSuggestions] = useState<Partial<Record<ParsedThaiIdField, string>>>({})
  const [ocrFailed, setOcrFailed] = useState(false)
  const [ocrReviewed, setOcrReviewed] = useState(false)
  const [ocrReviewError, setOcrReviewError] = useState(false)
  const [isScannerOpen, setIsScannerOpen] = useState(false)
  // "อัปโหลดรูปบัตร": opens the photo library / file picker of this device, then the same OCR as the camera.
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const [readingPhotoPercent, setReadingPhotoPercent] = useState<number | null>(null)
  const [photoError, setPhotoError] = useState('')
  const [isPhotoPreviewOpen, setIsPhotoPreviewOpen] = useState(false)
  const lastPhotoTapRef = useRef(0)

  useEffect(() => {
    setOcrFilled([])
    setOcrMissing([])
    setOcrSuggestions({})
    setOcrFailed(false)
    setOcrReviewed(false)
    setOcrReviewError(false)
    setPhotoError('')
    setIsPhotoPreviewOpen(false)
    if (editingCustomer) {
      setCode(editingCustomer.customerCode || '')
      setName(editingCustomer.customerName || '')
      setPhone(editingCustomer.phone || '')
      setPhone2(editingCustomer.phone2 || '')
      setEmail(editingCustomer.email || '')
      setLineId(editingCustomer.lineId || '')
      setHouseNo(editingCustomer.houseNo || '')
      setMoo(editingCustomer.moo || '')
      setSoi(editingCustomer.soi || '')
      setRoad(editingCustomer.road || '')
      setSelectedProvince(editingCustomer.province || '')
      setSelectedDistrict(editingCustomer.district || '')
      setSelectedSubDistrict(editingCustomer.subDistrict || '')
      setPostalCode(editingCustomer.postalCode || '')
      // One field for the ID card number / tax ID (a person's tax ID is the ID card number).
      const idOrTax = editingCustomer.idCardNumber || editingCustomer.taxId || ''
      setIdCardNumber(idOrTax ? formatThaiNationalId(idOrTax) : '')
      setIdCardExpiry(editingCustomer.idCardExpiry || '')
      setBirthDate(editingCustomer.birthDate || '')
      setIdCardImageUrl(editingCustomer.idCardImageUrl || '')
      setUploadedFileName(editingCustomer.idCardImageUrl ? 'รูปบัตรที่แนบไว้' : '')
    } else {
      setCode('CUST-' + String(Date.now()).slice(-6))
      setName('')
      setPhone('')
      setPhone2('')
      setEmail('')
      setLineId('')
      setHouseNo('')
      setMoo('')
      setSoi('')
      setRoad('')
      setSelectedProvince('')
      setSelectedDistrict('')
      setSelectedSubDistrict('')
      setPostalCode('')
      setIdCardNumber('')
      setIdCardExpiry('')
      setBirthDate('')
      setIdCardImageUrl('')
      setUploadedFileName('')
    }
  }, [editingCustomer, isOpen])

  useEffect(() => {
    if (!isOpen || thaiAddressData.length > 0) return

    let active = true
    setIsLoadingThaiAddresses(true)
    setThaiAddressLoadError(null)
    import('@/lib/thai-address-data')
      .then((addressModule) => {
        if (!active) return
        setThaiAddressData(addressModule.THAI_ADDRESS_DATA)
        setThaiProvinceOptions(addressModule.ALL_THAI_PROVINCES)
      })
      .catch((error: unknown) => {
        console.error('Failed to load Thai address data:', error)
        if (active) setThaiAddressLoadError('โหลดข้อมูลจังหวัดไม่สำเร็จ กรุณาลองปิดแล้วเปิดหน้าต่างนี้ใหม่')
      })
      .finally(() => {
        if (active) setIsLoadingThaiAddresses(false)
      })

    return () => {
      active = false
    }
  }, [isOpen, thaiAddressData.length])

  // Memoize available Districts based on selected Province
  const currentProvinceData = useMemo(() => {
    return thaiAddressData.find((p) => p.name === selectedProvince)
  }, [selectedProvince, thaiAddressData])

  const availableDistricts = useMemo(() => {
    // No made-up district names: an unknown province is typed in by hand instead.
    return currentProvinceData ? currentProvinceData.districts.map((d) => d.name) : []
  }, [currentProvinceData])

  // Memoize available SubDistricts based on selected District
  const currentDistrictData = useMemo(() => {
    return currentProvinceData?.districts.find((d) => d.name === selectedDistrict)
  }, [currentProvinceData, selectedDistrict])

  const availableSubDistricts = useMemo(() => {
    return currentDistrictData ? currentDistrictData.subDistricts : []
  }, [currentDistrictData])

  // A new province / district clears the parts below it; the user picks them (nothing is pre-selected).
  const handleProvinceChange = (prov: string) => {
    if (prov === selectedProvince) return
    setSelectedProvince(prov)
    setSelectedDistrict('')
    setSelectedSubDistrict('')
    setPostalCode('')
  }

  const handleDistrictChange = (dist: string) => {
    if (dist === selectedDistrict) return
    setSelectedDistrict(dist)
    setSelectedSubDistrict('')
    setPostalCode('')
  }

  // Handle SubDistrict Change
  const handleSubDistrictChange = (subDist: string) => {
    setSelectedSubDistrict(subDist)
    const subMatch = currentDistrictData?.subDistricts.find((s) => s.name === subDist)
    if (subMatch) {
      setPostalCode(subMatch.postalCode)
    }
  }

  // File Upload Handler for ID Card Image
  const handleUploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // the same photo can be chosen again
    if (!file || readingPhotoPercent !== null) return
    const dataUrl = await readIdCardPhotoFile(file)
    if (!dataUrl) {
      setPhotoError('ใช้รูป JPG, PNG หรือ WebP ขนาดไม่เกิน 8 MB')
      return
    }
    setPhotoError('')
    setReadingPhotoPercent(0)
    try {
      handleScanComplete(await scanIdCardPhoto(dataUrl, setReadingPhotoPercent))
      setUploadedFileName(file.name)
    } finally {
      setReadingPhotoPercent(null)
    }
  }

  // Only the fields on this form (no card expiry / birth date since 2026-10-31): the card never fills
  // a value the user cannot see and check. Existing customers keep those values when saved.
  const ocrSetters: Partial<Record<ParsedThaiIdField, { current: string; set: (v: string) => void }>> = {
    name: { current: name, set: setName },
    idCardNumber: { current: idCardNumber, set: (v) => setIdCardNumber(formatThaiNationalId(v)) },
    houseNo: { current: houseNo, set: setHouseNo },
    moo: { current: moo, set: setMoo },
    soi: { current: soi, set: setSoi },
    road: { current: road, set: setRoad },
    province: { current: selectedProvince, set: setSelectedProvince },
    district: { current: selectedDistrict, set: setSelectedDistrict },
    subDistrict: { current: selectedSubDistrict, set: setSelectedSubDistrict },
  }

  // OCR (owner 2026-10-31): everything the card was read for goes straight into its EMPTY field,
  // highlighted for review (the user ticks the check before saving). A field the user already typed
  // is never overwritten: a different card value is offered there to put in by hand. The address
  // chain is filled only as a whole, when province / district / sub-district are all empty.
  // Anything the card could not be read for stays empty.
  const handleScanComplete = (scannedData: ExtractedIDCardData) => {
    const filled: ParsedThaiIdField[] = []
    const missing: ParsedThaiIdField[] = []
    const suggestions: Partial<Record<ParsedThaiIdField, string>> = {}
    const addressEmpty = !selectedProvince && !selectedDistrict && !selectedSubDistrict
    for (const [key, target] of Object.entries(ocrSetters) as [ParsedThaiIdField, { current: string; set: (v: string) => void }][]) {
      const value = scannedData[key]
      if (!value) {
        missing.push(key)
      } else if (['province', 'district', 'subDistrict'].includes(key)) {
        if (addressEmpty) {
          target.set(value)
          filled.push(key)
        }
      } else if (!target.current.trim()) {
        target.set(value)
        filled.push(key)
      } else if (target.current.trim() !== value) {
        suggestions[key] = value
      }
    }

    if (scannedData.croppedImageDataUrl) {
      setIdCardImageUrl(scannedData.croppedImageDataUrl)
      setUploadedFileName('รูปจากการสแกนบัตร')
    }
    setOcrFailed(Boolean(scannedData.ocrFailed))
    setOcrFilled((prev) => Array.from(new Set([...prev, ...filled])))
    setOcrMissing(scannedData.ocrFailed ? [] : missing)
    setOcrSuggestions(suggestions)
    setOcrReviewed(false)
    setOcrReviewError(false)
    setIsScannerOpen(false)
  }

  const acceptOcrSuggestion = (key: ParsedThaiIdField) => {
    const value = ocrSuggestions[key]
    if (!value) return
    ocrSetters[key]?.set(value)
    setOcrFilled((prev) => Array.from(new Set([...prev, key])))
    setOcrSuggestions((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    setOcrReviewed(false)
  }

  /** Amber ring on a field the OCR filled, until the user confirms the review. */
  const ocrRing = (...keys: ParsedThaiIdField[]) =>
    !ocrReviewed && keys.some((k) => ocrFilled.includes(k)) ? ' ring-2 ring-amber-400 border-amber-400' : ''

  // Handle ID Card Input formatting
  const handleIdCardNumberChange = (value: string) => {
    const formatted = formatThaiNationalId(value)
    setIdCardNumber(formatted)
  }

  const isIdCardValid = useMemo(() => {
    const clean = idCardNumber.replace(/\D/g, '')
    if (clean.length === 13) {
      return validateThaiNationalId(clean)
    }
    return null
  }, [idCardNumber])

  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || isSubmitting) return
    if (ocrFilled.length > 0 && !ocrReviewed) {
      setOcrReviewError(true)
      return
    }

    const fullHouseAddress = [
      houseNo && `เลขที่ ${houseNo}`,
      moo && `หมู่ ${moo}`,
      soi && `ซอย ${soi}`,
      road && `ถนน ${road}`,
    ].filter(Boolean).join(' ') || houseNo

    // Only the parts that were filled in (no bare "ต. อ. จ." when the address is empty).
    const fullFormattedAddress = [
      fullHouseAddress,
      selectedSubDistrict && `ต.${selectedSubDistrict}`,
      selectedDistrict && `อ.${selectedDistrict}`,
      selectedProvince && `จ.${selectedProvince}`,
      postalCode,
    ].filter(Boolean).join(' ')

    // Only the name is required (owner 2026-11-11): phone and address may stay empty.
    const newCustomer: Customer = {
      id: editingCustomer ? editingCustomer.id : `c_${Date.now()}`,
      customerCode: code || ('CUST-' + String(Date.now()).slice(-6)),
      customerName: name.trim(),
      phone: phone,
      phone2: phone2 || undefined,
      email: email || undefined,
      lineId: lineId || undefined,
      // One field for both: a person's tax ID is the ID card number.
      taxId: idCardNumber.replace(/\D/g, '') || undefined,
      houseNo: houseNo || undefined,
      moo: moo || undefined,
      soi: soi || undefined,
      road: road || undefined,
      province: selectedProvince,
      district: selectedDistrict,
      subDistrict: selectedSubDistrict,
      postalCode,
      address: fullFormattedAddress,
      idCardNumber: idCardNumber.replace(/\D/g, ''),
      idCardExpiry,
      birthDate: birthDate || undefined,
      idCardImageUrl,
      isSuspended: editingCustomer ? editingCustomer.isSuspended : false,
    }

    setIsSubmitting(true)
    try {
      const saved = await onSave(newCustomer)
      if (saved !== false) onClose()
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <>
      <AppModal isOpen={isOpen} onClose={onClose} size="lg">
        {/* Modal Header */}
        <AppModalHeader
          onClose={onClose}
          icon={<User className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
          title={editingCustomer ? 'แก้ไขข้อมูลลูกค้า' : 'บันทึกข้อมูลลูกค้าใหม่'}
          headerActions={
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsScannerOpen(true)}
                disabled={readingPhotoPercent !== null}
                className={`${COMMAND_BUTTON_SIZE_CLASSES} bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-xs flex items-center transition-all active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>📸 เปิดกล้องสแกนบัตร</span>
              </button>
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={readingPhotoPercent !== null}
                className={`${COMMAND_BUTTON_SIZE_CLASSES} bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 shadow-xs flex items-center transition-all active:scale-95 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                {readingPhotoPercent !== null ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                <span>{readingPhotoPercent !== null ? `กำลังอ่านบัตร... ${readingPhotoPercent}%` : 'อัปโหลดรูปบัตร'}</span>
              </button>
              <input
                ref={photoInputRef}
                type="file"
                accept={ID_CARD_PHOTO_ACCEPT}
                aria-label="อัปโหลดรูปบัตรประชาชน"
                onChange={handleUploadPhoto}
                className="hidden"
              />
            </div>
          }
        />

        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
          <AppModalBody className="space-y-3 py-3">
            {ocrFailed && (
              <div role="status" aria-label="ผลการอ่านบัตร" className="p-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 rounded-xl text-amber-900 dark:text-amber-200 font-bold text-xs flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>อ่านข้อมูลจากบัตรไม่สำเร็จ แนบรูปบัตรไว้แล้ว กรุณากรอกข้อมูลเอง</span>
              </div>
            )}
            {!ocrFailed && (ocrFilled.length > 0 || ocrMissing.length > 0 || Object.keys(ocrSuggestions).length > 0) && (
              <div role="status" aria-label="ผลการอ่านบัตร" className="p-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 rounded-xl text-amber-900 dark:text-amber-200 text-xs space-y-1">
                <p className="font-extrabold flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  {ocrFilled.length > 0 ? 'อ่านจากบัตรได้บางส่วน — ช่องกรอบสีเหลืองมาจากการอ่านบัตร กรุณาตรวจให้ตรงกับบัตรจริง' : 'อ่านข้อมูลจากบัตรไม่ได้ กรุณากรอกเอง'}
                </p>
                {ocrFilled.length > 0 && <p>อ่านได้: {ocrFilled.map((k) => OCR_FIELD_LABELS[k]).join(', ')}</p>}
                {Object.keys(ocrSuggestions).length > 0 && (
                  <div className="space-y-1">
                    <p className="font-bold">ช่องนี้มีข้อมูลที่กรอกไว้แล้ว แต่อ่านจากบัตรได้ไม่ตรงกัน — กดใส่ถ้าต้องการใช้ค่าจากบัตร:</p>
                    {(Object.entries(ocrSuggestions) as [ParsedThaiIdField, string][]).map(([key, suggested]) => (
                      <div key={key} className="flex items-center gap-2">
                        <span>{OCR_FIELD_LABELS[key]}: <span className="font-mono font-bold">{suggested}</span></span>
                        <button
                          type="button"
                          onClick={() => acceptOcrSuggestion(key)}
                          className={`${COMMAND_BUTTON_SIZE_CLASSES} border border-amber-400 bg-white dark:bg-slate-900`}
                        >
                          ใส่ในช่อง{OCR_FIELD_LABELS[key]}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {ocrMissing.length > 0 && <p>อ่านไม่ได้ (เว้นว่างไว้): {ocrMissing.map((k) => OCR_FIELD_LABELS[k]).join(', ')}</p>}
                {ocrFilled.length > 0 && (
                  <label className="flex items-center gap-1.5 font-bold pt-0.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ocrReviewed}
                      onChange={(e) => {
                        setOcrReviewed(e.target.checked)
                        setOcrReviewError(false)
                      }}
                    />
                    <span>ฉันตรวจข้อมูลที่อ่านจากบัตรแล้ว ถูกต้องตรงกับบัตรจริง</span>
                  </label>
                )}
                {ocrReviewError && (
                  <p role="alert" className="font-bold text-red-700 dark:text-red-400">กรุณาตรวจข้อมูลที่อ่านจากบัตรแล้วติ๊กยืนยันก่อนบันทึก</p>
                )}
              </div>
            )}

            {/* Customer details, 4 columns (owner 2026-10-31):
                ชื่อ (2) | เลขบัตรประชาชน/เลขผู้เสียภาษี (2)
                บ้านเลขที่ | หมู่ | ซอย | ถนน
                ตำบล | อำเภอ | จังหวัด | รหัสไปรษณีย์
                เบอร์หลัก | เบอร์สำรอง | อีเมล (2)
                LINE ID (2) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2">
              <div className="col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                  ชื่อลูกค้า / ชื่อบริษัท <span className="text-rose-700 dark:text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  aria-label="ชื่อลูกค้า / ชื่อบริษัท"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={`w-full px-3 h-[30px] py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-bold text-xs focus:outline-none focus:ring-2 focus:ring-blue-500${ocrRing('name')}`}
                  required
                />
              </div>

              <div className="col-span-2">
                <div className="flex justify-between items-center mb-0.5">
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    เลขบัตรประชาชน / เลขผู้เสียภาษี
                  </label>
                  {isIdCardValid === true && (
                    <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>เลขถูกต้อง</span>
                    </span>
                  )}
                  {isIdCardValid === false && (
                    <span className="text-[10px] text-rose-700 dark:text-rose-400 font-bold flex items-center gap-0.5">
                      <AlertTriangle className="w-3 h-3" />
                      <span>ตรวจสอบเลข 13 หลัก</span>
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  aria-label="เลขบัตรประชาชน / เลขผู้เสียภาษี"
                  value={idCardNumber}
                  onChange={(e) => handleIdCardNumberChange(e.target.value)}
                  className={`w-full px-3 h-[30px] py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono font-bold text-xs focus:outline-none focus:ring-2 focus:ring-blue-500${ocrRing('idCardNumber')}`}
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                  บ้านเลขที่
                </label>
                <input
                  type="text"
                  aria-label="บ้านเลขที่"
                  value={houseNo}
                  onChange={(e) => setHouseNo(e.target.value)}
                  className={`w-full px-3 h-[30px] py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-bold text-xs focus:outline-none focus:ring-2 focus:ring-blue-500${ocrRing('houseNo')}`}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                  หมู่
                </label>
                <input
                  type="text"
                  aria-label="หมู่"
                  value={moo}
                  onChange={(e) => setMoo(e.target.value)}
                  className={`w-full px-3 h-[30px] py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500${ocrRing('moo')}`}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                  ซอย
                </label>
                <input
                  type="text"
                  aria-label="ซอย"
                  value={soi}
                  onChange={(e) => setSoi(e.target.value)}
                  className={`w-full px-3 h-[30px] py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500${ocrRing('soi')}`}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                  ถนน
                </label>
                <input
                  type="text"
                  aria-label="ถนน"
                  value={road}
                  onChange={(e) => setRoad(e.target.value)}
                  className={`w-full px-3 h-[30px] py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500${ocrRing('road')}`}
                />
              </div>

              {/* จังหวัด → อำเภอ → ตำบล are still picked in that order: each list follows the one above it */}
              <div className={`min-w-0 rounded-xl${ocrRing('subDistrict')}`}>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                  ตำบล / แขวง
                </label>
                <CustomSelect
                  searchable={true}
                  ariaLabel="ตำบล / แขวง"
                  placeholder="-- เลือกตำบล --"
                  value={selectedSubDistrict}
                  onChange={(val) => handleSubDistrictChange(String(val))}
                  options={availableSubDistricts.map((s) => ({
                    value: s.name,
                    label: s.name,
                    sublabel: s.postalCode ? `ปณ. ${s.postalCode}` : undefined,
                  }))}
                />
              </div>
              <div className={`min-w-0 rounded-xl${ocrRing('district')}`}>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                  อำเภอ / เขต
                </label>
                <CustomSelect
                  searchable={true}
                  ariaLabel="อำเภอ / เขต"
                  placeholder="-- เลือกอำเภอ --"
                  value={selectedDistrict}
                  onChange={(val) => handleDistrictChange(String(val))}
                  options={availableDistricts.map((d) => ({ value: d, label: d }))}
                />
              </div>
              <div className={`min-w-0 rounded-xl${ocrRing('province')}`}>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                  จังหวัด
                </label>
                <CustomSelect
                  searchable={true}
                  ariaLabel="จังหวัด"
                  placeholder="-- เลือกจังหวัด --"
                  value={selectedProvince}
                  onChange={(val) => handleProvinceChange(String(val))}
                  options={thaiProvinceOptions.map((p) => ({ value: p, label: p }))}
                />
                {isLoadingThaiAddresses && (
                  <p className="mt-1 text-[10px] text-slate-600 dark:text-slate-400" role="status">กำลังโหลดข้อมูลจังหวัด...</p>
                )}
                {thaiAddressLoadError && (
                  <p className="mt-1 text-[10px] text-red-700 dark:text-red-400" role="alert">{thaiAddressLoadError}</p>
                )}
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                  รหัสไปรษณีย์
                </label>
                <input
                  type="text"
                  aria-label="รหัสไปรษณีย์"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  className="w-full px-3 h-[30px] py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono font-bold text-center text-blue-600 dark:text-blue-400 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                  เบอร์โทรศัพท์หลัก
                </label>
                <input
                  type="tel"
                  aria-label="เบอร์โทรศัพท์หลัก"
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
                  className="w-full px-3 h-[30px] py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-bold text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                  เบอร์โทรศัพท์สำรอง
                </label>
                <input
                  type="tel"
                  aria-label="เบอร์โทรศัพท์สำรอง"
                  value={phone2}
                  onChange={(e) => setPhone2(formatPhoneNumber(e.target.value))}
                  className="w-full px-3 h-[30px] py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                  อีเมล
                </label>
                <input
                  type="email"
                  aria-label="อีเมล"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 h-[30px] py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-0.5">
                  LINE ID
                </label>
                <input
                  type="text"
                  aria-label="LINE ID"
                  value={lineId}
                  onChange={(e) => setLineId(e.target.value)}
                  className="w-full px-3 h-[30px] py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* ID card photo, centred in the space below (camera / upload buttons are at the top).
                Double-click (double-tap on touch) shows it full size. */}
            <div className="flex flex-col items-center justify-center gap-1.5 pt-2">
              <div className="w-full sm:w-[calc((100%-0.75rem)/2)] aspect-[85.6/53.98] rounded-xl bg-slate-900 shadow-sm relative overflow-hidden flex flex-col justify-between border border-blue-400/40">
                {idCardImageUrl ? (
                  <div
                    className="absolute inset-0 bg-slate-950 flex items-center justify-center group cursor-zoom-in select-none"
                    title="ดับเบิ้ลคลิกเพื่อดูรูปบัตรขนาดจริง"
                    onDoubleClick={(e) => {
                      if ((e.target as HTMLElement).closest('button')) return
                      window.getSelection()?.removeAllRanges()
                      setIsPhotoPreviewOpen(true)
                    }}
                    onTouchEnd={(e) => {
                      if ((e.target as HTMLElement).closest('button')) return
                      const now = Date.now()
                      if (now - lastPhotoTapRef.current < 320) {
                        e.preventDefault() // no synthetic dblclick / zoom
                        lastPhotoTapRef.current = 0
                        setIsPhotoPreviewOpen(true)
                      } else {
                        lastPhotoTapRef.current = now
                      }
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={idCardImageUrl}
                      alt="ID Card"
                      className="w-full h-full object-contain rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setIdCardImageUrl('')
                        setUploadedFileName('')
                      }}
                      className={`${COMMAND_BUTTON_SIZE_CLASSES} w-8 px-0 inline-flex items-center justify-center absolute top-1 right-1 bg-rose-600/90 text-white hover:bg-rose-700 transition-all opacity-80 hover:opacity-100`}
                      title="ลบรูปบัตร"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-slate-600 dark:text-slate-400 text-[11px] font-bold">
                    <Camera className="w-6 h-6" />
                  </div>
                )}
              </div>

              {photoError && (
                <p role="alert" className="text-[10px] font-bold text-rose-700 dark:text-rose-300">{photoError}</p>
              )}

              {uploadedFileName && (
                <p className="text-[10px] text-blue-600 dark:text-blue-400 font-mono truncate max-w-full">
                  📄 {uploadedFileName}
                </p>
              )}
            </div>
          </AppModalBody>

          {/* Footer / ปุ่มล่าง */}
          <AppModalFooter>
            <button
              type="button"
              onClick={onClose}
              className={`${COMMAND_BUTTON_SIZE_CLASSES} border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer`}
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`${COMMAND_BUTTON_SIZE_CLASSES} bg-emerald-700 hover:bg-emerald-800 text-white shadow-md shadow-emerald-600/20 flex items-center transition-all active:scale-95 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              <Check className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'กำลังบันทึก...' : 'บันทึกข้อมูลลูกค้า'}</span>
            </button>
          </AppModalFooter>
        </form>
      </AppModal>

      {isPhotoPreviewOpen && idCardImageUrl && (
        <IdCardPhotoPreview src={idCardImageUrl} onClose={() => setIsPhotoPreviewOpen(false)} />
      )}

      {/* Standalone ID Card Scanner Modal */}
      {isScannerOpen && (
        <IDCardScannerModal
          isOpen={isScannerOpen}
          onClose={() => setIsScannerOpen(false)}
          onScanComplete={handleScanComplete}
        />
      )}
    </>
  )
}

/**
 * The ID card photo at its real size (shrunk only to fit the screen), like the A4 full preview:
 * a click / tap anywhere or Esc closes it, and Esc never closes the customer window behind it.
 */
function IdCardPhotoPreview({ src, onClose }: Readonly<{ src: string; onClose: () => void }>) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[9999] bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-4 select-none animate-in fade-in duration-200 cursor-zoom-out"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="รูปบัตรประชาชนขนาดจริง"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="รูปบัตรประชาชนขนาดจริง" className="max-w-full max-h-[calc(100dvh-5rem)] object-contain rounded-lg shadow-2xl" />
        <div className="mt-3 text-center text-white/90 text-xs font-semibold bg-black/60 px-4 py-1.5 rounded-full backdrop-blur-md shadow-lg border border-white/10">
          คลิกหรือแตะที่ใดก็ได้เพื่อปิด (Esc)
        </div>
      </div>
    </ModalPortal>
  )
}
