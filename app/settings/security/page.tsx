import { redirect } from 'next/navigation'

/** Old address of the PIN page: it now lives in ตั้งค่าส่วนตัว. */
export default function SecuritySettingsPage() {
  redirect('/account?tab=SECURITY')
}
