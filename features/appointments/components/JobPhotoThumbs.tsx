'use client'
import React, { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Photos a driver sent with a job step from the LINE job form (owner 2026-11-13). They sit in the
 * private bucket job-photos; links are signed for 10 minutes (read needs the appointments menu).
 */
const JOB_PHOTO_BUCKET = 'job-photos'

export function JobPhotoThumbs({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<string[]>([])
  const key = paths.join('|')
  useEffect(() => {
    let alive = true
    const list = key ? key.split('|') : []
    if (!list.length) return
    createClient()
      .storage.from(JOB_PHOTO_BUCKET)
      .createSignedUrls(list, 600)
      .then(({ data }) => {
        if (alive) setUrls((data ?? []).map((d) => d.signedUrl).filter((u): u is string => !!u))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [key])
  if (!urls.length) return null
  return (
    <div className="flex gap-1.5 flex-wrap pt-0.5">
      {urls.map((url, i) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" aria-label={`รูปจากคนขับ ${i + 1}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`รูปจากคนขับ ${i + 1}`} className="w-10 h-10 object-cover rounded-lg border border-slate-200 dark:border-slate-700" />
        </a>
      ))}
    </div>
  )
}
