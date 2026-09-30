'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { setCachedProducts } from '@/features/products/services/product-storage'
import { setCachedCategories } from '@/lib/category-rules-storage'
import { setCachedUnits } from '@/lib/unit-storage'
import { setCachedCustomers } from '@/features/customers/services/customer-storage'
import { fetchProductsFromSupabase, fetchCategoriesFromSupabase, fetchUnitsFromSupabase } from '@/features/products/api/product-repository'
import { fetchCustomersFromSupabase } from '@/features/customers/api/customer-repository'
import { fetchBillsFromSupabase, setCachedBills } from '@/features/bills/services/bill-storage'
import { fetchQuotationsFromSupabase, setCachedQuotations } from '@/features/quotations/services/quotation-storage'
import { fetchAppointmentsFromSupabase, setCachedAppointments } from '@/features/appointments/services/appointment-storage'
import { fetchTransactionsFromSupabase, setCachedTransactions } from '@/features/finance/services/finance-storage'
import { fetchReservationsFromSupabase, setCachedReservations } from '@/features/reservations/services/reservation-storage'
import { fetchBackordersFromSupabase, setCachedBackorders } from '@/features/reservations/services/backorder-storage'
import { RefreshCw } from 'lucide-react'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { createClient } from '@/lib/supabase/client'

interface MasterDataContextType {
  isLoaded: boolean
  error: Error | null
}

const MasterDataContext = createContext<MasterDataContextType>({ isLoaded: false, error: null })

export function useMasterData() {
  return useContext(MasterDataContext)
}

export function MasterDataProvider({ children }: { children: React.ReactNode }) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const { session, loading: authLoading } = useAuth()

  useEffect(() => {
    async function initData() {
      if (authLoading) return
      
      if (!session) {
        setCachedProducts([])
        setCachedCategories([])
        setCachedUnits([])
        setCachedCustomers([])
        setCachedBills([])
        setCachedQuotations([])
        setCachedAppointments([])
        setCachedTransactions([])
        setCachedReservations([])
        setCachedBackorders([])
        setIsLoaded(true)
        return
      }

      setIsLoaded(false)
      setError(null)

      try {
        const [products, categories, units, customers] = await Promise.all([
          fetchProductsFromSupabase(),
          fetchCategoriesFromSupabase(),
          fetchUnitsFromSupabase(),
          fetchCustomersFromSupabase()
        ])

        // Categories mapping
        setCachedCategories(categories.map(c => ({ 
          id: c.id, 
          name: c.name,
          calculationType: c.calculation_type,
          calculationLabel: c.calculation_label,
          defaultUnitId: c.default_unit_id,
          isDefault: c.is_default,
          isActive: c.is_active
        })))
        
        // Units mapping
        setCachedUnits(units.map(u => ({ 
          id: u.id, 
          name: u.name, 
          isActive: u.is_active ?? true 
        })))

        // Products mapping (already done inside fetchProductsFromSupabase)
        setCachedProducts(products)

        // Customers mapping (already done inside fetchCustomersFromSupabase)
        setCachedCustomers(customers)

        // Hydrate business entities from Supabase
        await Promise.all([
          fetchBillsFromSupabase(),
          fetchQuotationsFromSupabase(),
          fetchAppointmentsFromSupabase(),
          fetchTransactionsFromSupabase(),
          fetchReservationsFromSupabase(),
          fetchBackordersFromSupabase(),
        ])

        setIsLoaded(true)
      } catch (err: any) {
        console.error('Failed to load master data from Supabase:', err)
        setError(err)
      }
    }
    initData()
  }, [session, authLoading])

  useEffect(() => {
    if (authLoading || !session) return

    let active = true
    const supabase = createClient()
    const refreshDomains: Record<string, () => Promise<void>> = {
      products: async () => {
        setCachedProducts(await fetchProductsFromSupabase())
      },
      categories: async () => {
        const [categories, products] = await Promise.all([
          fetchCategoriesFromSupabase(),
          fetchProductsFromSupabase(),
        ])
        setCachedCategories(categories.map((category) => ({
          id: category.id,
          name: category.name,
          calculationType: category.calculation_type,
          calculationLabel: category.calculation_label,
          defaultUnitId: category.default_unit_id,
          isDefault: category.is_default,
          isActive: category.is_active,
        })))
        setCachedProducts(products)
      },
      units: async () => {
        const [units, products] = await Promise.all([
          fetchUnitsFromSupabase(),
          fetchProductsFromSupabase(),
        ])
        setCachedUnits(units.map((unit) => ({
          id: unit.id,
          name: unit.name,
          isActive: unit.is_active ?? true,
        })))
        setCachedProducts(products)
      },
      customers: async () => setCachedCustomers(await fetchCustomersFromSupabase()),
      bills: async () => { await fetchBillsFromSupabase() },
      quotations: async () => { await fetchQuotationsFromSupabase() },
      appointments: async () => { await fetchAppointmentsFromSupabase() },
      transactions: async () => { await fetchTransactionsFromSupabase() },
      reservations: async () => { await fetchReservationsFromSupabase() },
      backorders: async () => { await fetchBackordersFromSupabase() },
    }
    const tableDomains: Record<string, string> = {
      products: 'products',
      stock_movements: 'products',
      product_categories: 'categories',
      units: 'units',
      customers: 'customers',
      bills: 'bills',
      quotations: 'quotations',
      quotation_items: 'quotations',
      appointments: 'appointments',
      statement_transactions: 'transactions',
      reservations: 'reservations',
      backorders: 'backorders',
    }
    const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const scheduleRefresh = (domain: string) => {
      const existingTimer = refreshTimers.get(domain)
      if (existingTimer) clearTimeout(existingTimer)
      refreshTimers.set(domain, setTimeout(() => {
        refreshTimers.delete(domain)
        void refreshDomains[domain]()
          .catch((refreshError: unknown) => {
            console.error(`Failed to refresh ${domain} after a database change:`, refreshError)
          })
      }, 250))
    }
    const channel = supabase.channel('business-data-sync')
    for (const [table, domain] of Object.entries(tableDomains)) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          if (active) scheduleRefresh(domain)
        }
      )
    }
    channel.subscribe((status: string, error?: Error) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('Business data realtime subscription failed:', error || status)
      }
    })

    return () => {
      active = false
      for (const timer of refreshTimers.values()) clearTimeout(timer)
      refreshTimers.clear()
      void supabase.removeChannel(channel)
    }
  }, [session, authLoading])

  if (authLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50 dark:bg-slate-900 text-slate-500">
        <div className="flex flex-col items-center">
          <RefreshCw className="h-8 w-8 animate-spin mb-4" />
          <p className="font-semibold">กำลังตรวจสอบสิทธิ์...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-red-50 text-red-500 flex-col">
        <h2 className="text-2xl font-bold mb-4">เชื่อมต่อฐานข้อมูลล้มเหลว</h2>
        <p>{error.message}</p>
      </div>
    )
  }

  if (!isLoaded) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50 dark:bg-slate-900 text-slate-500">
        <div className="flex flex-col items-center">
          <RefreshCw className="h-8 w-8 animate-spin mb-4" />
          <p className="font-semibold">กำลังโหลดข้อมูลระบบ...</p>
        </div>
      </div>
    )
  }

  return (
    <MasterDataContext.Provider value={{ isLoaded, error }}>
      {children}
    </MasterDataContext.Provider>
  )
}
