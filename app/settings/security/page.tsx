import { redirect } from 'next/navigation'

/** Old address of the PIN page: it now lives in บัญชีของฉัน. */
export default function SecuritySettingsPage() {
  redirect('/account?tab=SECURITY')
}
