import { type RichMenuKind } from './rich-menu'
import { type LineProvider } from './types'

/**
 * Makes LINE show each person the right chat menu (owner 2026-11-21). The database says who should have which kind
 * (only what the shop confirmed counts); this tells LINE. GENERAL is LINE's default menu, so a person who should have
 * it only needs their own menu taken away; the other kinds are linked person by person. A friend who blocked the OA is
 * never in the list. A failure is remembered (the same person waits 15 minutes) and never stops the others.
 */

export interface RichMenuPerson {
  id: string
  line_user_id: string
  kind: RichMenuKind
  from_kind: RichMenuKind | null
}

export interface RichMenuSyncStore {
  richMenuPending(limit: number): Promise<RichMenuPerson[]>
  richMenuPublished(): Promise<Partial<Record<RichMenuKind, string>>>
  richMenuMark(contactId: string, kind: RichMenuKind, ok: boolean): Promise<void>
  richMenuForUser(lineUserId: string): Promise<RichMenuPerson | null>
}

export interface RichMenuSyncResult {
  linked: number
  unlinked: number
  failed: number
}

export const hasRichMenuStore = (s: unknown): s is RichMenuSyncStore => {
  const o = s as Partial<RichMenuSyncStore>
  return typeof o.richMenuPending === 'function' && typeof o.richMenuPublished === 'function' && typeof o.richMenuMark === 'function' && typeof o.richMenuForUser === 'function'
}

/** `lineUserId`: one person who just added the OA (applied again even if the database thinks it is already right). */
export async function syncRichMenus(opts: { store: RichMenuSyncStore; provider: LineProvider | null; limit?: number; lineUserId?: string }): Promise<RichMenuSyncResult> {
  const result: RichMenuSyncResult = { linked: 0, unlinked: 0, failed: 0 }
  const { store, provider } = opts
  if (!provider?.linkRichMenu || !provider.unlinkRichMenu) return result

  const people = opts.lineUserId ? [await store.richMenuForUser(opts.lineUserId)].filter((p): p is RichMenuPerson => p !== null) : await store.richMenuPending(opts.limit ?? 50)
  if (people.length === 0) return result
  const published = people.some((p) => p.kind !== 'GENERAL') ? await store.richMenuPublished() : {}

  for (const p of people) {
    try {
      if (p.kind === 'GENERAL') {
        // back to the default menu; "nothing to take away" (404) is as good as done
        const r = await provider.unlinkRichMenu(p.line_user_id)
        const ok = r.ok || r.status === 404
        await store.richMenuMark(p.id, 'GENERAL', ok)
        if (ok) result.unlinked++
        else result.failed++
        continue
      }
      const menuId = published[p.kind]
      if (!menuId) continue
      const r = await provider.linkRichMenu(p.line_user_id, menuId)
      await store.richMenuMark(p.id, p.kind, r.ok)
      if (r.ok) result.linked++
      else result.failed++
    } catch {
      result.failed++
    }
  }
  return result
}
