'use client'

/**
 * The LINE profile picture when LINE gave one (https address only, checked again by the database), else the first
 * letters of the name. A plain <img>: the address is LINE's own CDN and changes per person, nothing to optimise.
 */
export function LinePersonAvatar({ name, pictureUrl, size = 'sm' }: { name: string | null; pictureUrl: string | null; size?: 'sm' | 'lg' }) {
  const box = size === 'lg' ? 'w-14 h-14 text-sm' : 'w-7 h-7 text-[10px]'
  if (pictureUrl && /^https:\/\//.test(pictureUrl)) {
    // eslint-disable-next-line @next/next/no-img-element -- LINE's own picture address, one per person
    return <img src={pictureUrl} alt={name ? `รูปโปรไฟล์ LINE ของ ${name}` : 'รูปโปรไฟล์ LINE'} referrerPolicy="no-referrer" className={`${box} rounded-full object-cover shrink-0 bg-slate-200`} />
  }
  return (
    <span className={`${box} rounded-full grid place-items-center font-bold shrink-0 bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200`}>
      {(name || '?').trim().slice(0, 2)}
    </span>
  )
}
