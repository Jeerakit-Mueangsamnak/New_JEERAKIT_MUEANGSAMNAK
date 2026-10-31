import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Camera, RefreshCw, AlertCircle, Scan, Sparkles } from 'lucide-react'
import { AppModal, AppModalHeader, AppModalBody } from '@/components/common/AppModal'
import { logger } from '@/lib/utils/logger'
import { scanIdCardPhoto, type ScannedIdCard } from '@/features/customers/services/id-card-ocr'

/** Only values the parser could prove; anything it could not read is ''. */
export type ExtractedIDCardData = ScannedIdCard

type Box = { left: number; top: number; width: number; height: number }

/**
 * The part of the camera frame under the on-screen card guide. The video is shown with
 * object-cover: the frame is scaled by the larger ratio and centred, its overflow hidden.
 * Without a measured guide: the guide's own shape, centred, 75% wide, card proportion 1.586.
 */
export function cropRectForGuide(frame: { width: number; height: number }, shown: Box, guide: Box | null) {
  if (!guide || guide.width <= 0 || shown.width <= 0 || shown.height <= 0) {
    const width = frame.width * 0.75
    const height = width / 1.586
    return { x: (frame.width - width) / 2, y: (frame.height - height) / 2, width, height }
  }
  const scale = Math.max(shown.width / frame.width, shown.height / frame.height)
  const offsetX = (shown.width - frame.width * scale) / 2
  const offsetY = (shown.height - frame.height * scale) / 2
  const x = Math.max(0, (guide.left - shown.left - offsetX) / scale)
  const y = Math.max(0, (guide.top - shown.top - offsetY) / scale)
  return { x, y, width: Math.min(frame.width - x, guide.width / scale), height: Math.min(frame.height - y, guide.height / scale) }
}

interface IDCardScannerModalProps {
  isOpen: boolean
  onClose: () => void
  onScanComplete: (data: ExtractedIDCardData) => void
}

/** Camera window of "เปิดกล้องสแกนบัตร": the device camera opens at once with the card guide. */
export function IDCardScannerModal({ isOpen, onClose, onScanComplete }: IDCardScannerModalProps) {
  const [isScanning, setIsScanning] = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const scanInFlightRef = useRef(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [scanStatusMessage, setScanStatusMessage] = useState<string>('กำลังอ่านข้อมูลจากภาพถ่ายบัตรประชาชน...')

  const videoRef = useRef<HTMLVideoElement | null>(null)
  /** The card-shaped guide on screen: the snapshot is cut to exactly this area. */
  const guideRef = useRef<HTMLDivElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // Every start/stop takes a new number. A camera that answers after the window was closed (or
  // after a newer start) belongs to an old number and is switched off at once, never kept on.
  const cameraRequestRef = useRef(0)

  // Start Camera Stream
  const startCamera = useCallback(async () => {
    const request = ++cameraRequestRef.current
    setCameraError(null)
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'environment' },
      })
      if (request !== cameraRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraActive(true)
    } catch (err: unknown) {
      if (request !== cameraRequestRef.current) return
      logger.warn('Camera access error or unsupported:', err)
      // Browsers open the camera only on https:// (or localhost); a LAN http:// address never can.
      setCameraError(typeof window !== 'undefined' && !window.isSecureContext
        ? 'เบราว์เซอร์เปิดกล้องได้เฉพาะเว็บที่ขึ้นต้นด้วย https:// กรุณาเปิดระบบผ่าน https หรือใช้ปุ่ม "อัปโหลดรูปบัตร" แทน'
        : 'ไม่สามารถเข้าถึงกล้องได้ กรุณาอนุญาตสิทธิ์ใช้งานกล้อง หรือใช้ปุ่ม "อัปโหลดรูปบัตร" แทน')
      setCameraActive(false)
    }
  }, [])

  // Stop Camera Stream
  const stopCamera = useCallback(() => {
    cameraRequestRef.current += 1
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setCameraActive(false)
  }, [])

  useEffect(() => {
    if (isOpen) startCamera()
    else stopCamera()
    return () => {
      stopCamera()
    }
  }, [isOpen, startCamera, stopCamera])

  const closeScanner = () => {
    stopCamera()
    onClose()
  }

  // Snap photo from Video Stream and Crop to exactly the card guide shown on screen
  const handleCaptureCamera = async () => {
    if (!videoRef.current || scanInFlightRef.current) return
    const video = videoRef.current

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const { x: startX, y: startY, width: cardWidth, height: cardHeight } = cropRectForGuide(
      canvas,
      video.getBoundingClientRect(),
      guideRef.current?.getBoundingClientRect() ?? null
    )

    const croppedCanvas = document.createElement('canvas')
    croppedCanvas.width = 856
    croppedCanvas.height = 540
    croppedCanvas.getContext('2d')?.drawImage(canvas, startX, startY, cardWidth, cardHeight, 0, 0, 856, 540)

    scanInFlightRef.current = true
    stopCamera()
    setIsScanning(true)
    setScanStatusMessage('กำลังอ่านข้อมูลจากภาพถ่ายบัตรประชาชน...')
    const cardData = await scanIdCardPhoto(croppedCanvas.toDataURL('image/jpeg', 0.92), (percent) =>
      setScanStatusMessage(`กำลังอ่านข้อมูลจากภาพถ่ายบัตรประชาชน... ${percent}%`)
    )
    onScanComplete(cardData)
    onClose()
    setIsScanning(false)
    scanInFlightRef.current = false
  }

  if (!isOpen) return null

  return (
    <AppModal isOpen={isOpen} onClose={closeScanner} size="lg">
      <AppModalHeader
        onClose={closeScanner}
        icon={<Scan className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
        title="สแกนบัตรประชาชนด้วยกล้อง"
      />

      <AppModalBody className="space-y-4">
        {cameraError ? (
          <div className="p-6 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-rose-700 dark:text-rose-400 mx-auto" />
            <p className="text-xs text-rose-700 dark:text-rose-300 font-semibold">{cameraError}</p>
            <button
              type="button"
              onClick={startCamera}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 mx-auto transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              <span>ลองเปิดกล้องอีกครั้ง</span>
            </button>
          </div>
        ) : (
          <div className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden border-2 border-blue-500/50 shadow-inner flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />

            {/* ID card guide: card-shaped (85.6 × 53.98 mm), the exact area the snapshot keeps */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div
                ref={guideRef}
                data-testid="id-card-guide"
                className="relative w-3/4 aspect-[85.6/53.98] rounded-xl border-2 border-dashed border-blue-400 bg-blue-500/5 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
              >
                {/* Corner capture lines */}
                <span className="absolute -top-1 -left-1 w-7 h-7 border-t-4 border-l-4 border-blue-400 rounded-tl-xl" />
                <span className="absolute -top-1 -right-1 w-7 h-7 border-t-4 border-r-4 border-blue-400 rounded-tr-xl" />
                <span className="absolute -bottom-1 -left-1 w-7 h-7 border-b-4 border-l-4 border-blue-400 rounded-bl-xl" />
                <span className="absolute -bottom-1 -right-1 w-7 h-7 border-b-4 border-r-4 border-blue-400 rounded-br-xl" />
                <div className="absolute top-2 inset-x-2 flex justify-between items-start">
                  <span className="text-[10px] font-bold bg-blue-600 text-white px-2 py-0.5 rounded shadow flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    <span>วางบัตรประชาชนให้อยู่ในกรอบนี้</span>
                  </span>
                  <span className="text-[10px] font-mono text-amber-300 font-bold bg-black/60 px-2 py-0.5 rounded">
                    THAI NATIONAL ID
                  </span>
                </div>
              </div>
            </div>

            {/* Scanning Animation */}
            {isScanning && (
              <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm flex flex-col items-center justify-center space-y-3 animate-in fade-in z-20">
                <RefreshCw className="w-10 h-10 text-blue-400 animate-spin" />
                <p className="font-extrabold text-sm text-blue-200">{scanStatusMessage}</p>
              </div>
            )}
          </div>
        )}

        {!cameraError && (
          <>
            <p className="text-center font-bold text-[10px] text-slate-600 dark:text-slate-400">
              ระบบจะตัดภาพเฉพาะในกรอบ และดึงชื่อ-เลข 13 หลัก-ที่อยู่ให้อัตโนมัติ
            </p>

            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={handleCaptureCamera}
                disabled={isScanning || !cameraActive}
                className="px-8 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black text-sm rounded-2xl shadow-lg shadow-blue-500/30 flex items-center gap-2 transition-all hover:scale-102 active:scale-98 disabled:opacity-50 cursor-pointer"
              >
                <Camera className="w-5 h-5" />
                <span>📸 ถ่ายภาพ Snap & สแกนอ่านบัตร</span>
              </button>
            </div>
          </>
        )}
      </AppModalBody>
    </AppModal>
  )
}
