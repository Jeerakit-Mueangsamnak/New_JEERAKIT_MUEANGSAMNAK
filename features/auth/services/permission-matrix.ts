import { MENU_CATALOG, type MenuCode } from '@/features/auth/services/permissions'

/**
 * What each important action needs, as the database enforces it today (read only — there is no
 * separate per-action grant). An action runs when the member holds ANY of its menus
 * (public._require_menu, VARIADIC = any of); risky ones also ask the member's own PIN
 * (public._require_pin with the action code). The 6 risky actions marked `grant` also need the
 * OWNER's per-user grant (public._require_action, migration 20261007131509_member_action_grants).
 * OWNER-only actions are refused for every USER (public._require_owner / RLS).
 */
/** Actions the OWNER grants per USER (public.member_action_grants; USER default = denied). */
export const GRANTABLE_ACTIONS = ['PRODUCT_PRICE_CHANGE', 'STOCK_ADJUST', 'BILL_VOID', 'REFUND', 'EXPENSE', 'WRITE_OFF'] as const
export type ActionGrantCode = (typeof GRANTABLE_ACTIONS)[number]
