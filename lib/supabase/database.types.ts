// Generated from the Supabase Cloud schema (project kgfrxikiduqvejhlcyrv) after migrations
// settings_architecture_v1 + member_action_grants (2026-10-07). Regenerate after schema changes (Supabase MCP generate_typescript_types).
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      appointment_history: {
        Row: {
          after_data: Json | null
          appointment_id: string
          before_data: Json | null
          change_type: string
          created_at: string
          created_by: string
          id: string
          new_start_datetime: string | null
          original_start_datetime: string | null
          reason: string | null
        }
        Insert: {
          after_data?: Json | null
          appointment_id: string
          before_data?: Json | null
          change_type: string
          created_at?: string
          created_by: string
          id?: string
          new_start_datetime?: string | null
          original_start_datetime?: string | null
          reason?: string | null
        }
        Update: {
          after_data?: Json | null
          appointment_id?: string
          before_data?: Json | null
          change_type?: string
          created_at?: string
          created_by?: string
          id?: string
          new_start_datetime?: string | null
          original_start_datetime?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointment_history_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_history_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          appointment_no: string
          appointment_type: string
          assigned_user_id: string | null
          bill_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string
          customer_id: string | null
          description: string | null
          end_datetime: string
          id: string
          location: string | null
          priority: string
          related_entity_id: string | null
          related_entity_type: string | null
          reminder_before_minutes: number | null
          start_datetime: string
          status: string
          title: string
          updated_at: string
          work_order: Json
        }
        Insert: {
          appointment_no: string
          appointment_type: string
          assigned_user_id?: string | null
          bill_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by: string
          customer_id?: string | null
          description?: string | null
          end_datetime: string
          id?: string
          location?: string | null
          priority?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          reminder_before_minutes?: number | null
          start_datetime: string
          status?: string
          title: string
          updated_at?: string
          work_order?: Json
        }
        Update: {
          appointment_no?: string
          appointment_type?: string
          assigned_user_id?: string | null
          bill_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string | null
          description?: string | null
          end_datetime?: string
          id?: string
          location?: string | null
          priority?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          reminder_before_minutes?: number | null
          start_datetime?: string
          status?: string
          title?: string
          updated_at?: string
          work_order?: Json
        }
        Relationships: [
          {
            foreignKeyName: "appointments_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_balances_v"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "appointments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          after_data: Json | null
          amount: number | null
          before_data: Json | null
          channel: string | null
          correlation_id: string
          created_at: string
          device: string | null
          entity_id: string | null
          entity_type: string
          id: string
          pin_verified: boolean
          quantity: number | null
          reason: string | null
          result: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after_data?: Json | null
          amount?: number | null
          before_data?: Json | null
          channel?: string | null
          correlation_id: string
          created_at?: string
          device?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          pin_verified?: boolean
          quantity?: number | null
          reason?: string | null
          result?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after_data?: Json | null
          amount?: number | null
          before_data?: Json | null
          channel?: string | null
          correlation_id?: string
          created_at?: string
          device?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          pin_verified?: boolean
          quantity?: number | null
          reason?: string | null
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_adjustments: {
        Row: {
          adjustment_type: string
          after_data: Json | null
          amount: number
          before_data: Json | null
          bill_id: string
          bill_line_id: string | null
          correlation_id: string
          created_at: string
          created_by: string
          id: string
          reason: string
          return_id: string | null
          reverses_adjustment_id: string | null
          source: string
        }
        Insert: {
          adjustment_type: string
          after_data?: Json | null
          amount: number
          before_data?: Json | null
          bill_id: string
          bill_line_id?: string | null
          correlation_id: string
          created_at?: string
          created_by: string
          id?: string
          reason: string
          return_id?: string | null
          reverses_adjustment_id?: string | null
          source?: string
        }
        Update: {
          adjustment_type?: string
          after_data?: Json | null
          amount?: number
          before_data?: Json | null
          bill_id?: string
          bill_line_id?: string | null
          correlation_id?: string
          created_at?: string
          created_by?: string
          id?: string
          reason?: string
          return_id?: string | null
          reverses_adjustment_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_adjustments_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_adjustments_bill_line_id_fkey"
            columns: ["bill_line_id"]
            isOneToOne: false
            referencedRelation: "bill_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_adjustments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_adjustments_return_fk"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_adjustments_reverses_adjustment_id_fkey"
            columns: ["reverses_adjustment_id"]
            isOneToOne: true
            referencedRelation: "bill_adjustments"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_lines: {
        Row: {
          actual_return_at: string | null
          allocated_qty: number
          approved_disposition_qty: number
          approved_lost_qty: number
          backorder_qty: number
          base_amount: number
          bill_id: string
          cancelled_qty: number
          carried_forward_qty: number
          carried_in_qty: number
          created_at: string
          created_by: string
          delivered_qty: number
          extended_amount: number
          fulfillment_status: string
          id: string
          line_discount_amount: number
          line_discount_type: string | null
          line_discount_value: number
          line_mode: string
          line_no: number
          obligation_held_here: number
          ordered_qty: number
          overdue_reviewed_at: string | null
          overdue_reviewed_by: string | null
          period_count: number | null
          period_type: string | null
          physical_returned_qty: number
          price_overridden: boolean
          product_id: string
          rental_calculation_type: string | null
          rental_end_at: string | null
          rental_start_at: string | null
          rental_status: string | null
          return_status: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          actual_return_at?: string | null
          allocated_qty?: number
          approved_disposition_qty?: number
          approved_lost_qty?: number
          backorder_qty?: number
          base_amount?: number
          bill_id: string
          cancelled_qty?: number
          carried_forward_qty?: number
          carried_in_qty?: number
          created_at?: string
          created_by: string
          delivered_qty?: number
          extended_amount?: number
          fulfillment_status?: string
          id?: string
          line_discount_amount?: number
          line_discount_type?: string | null
          line_discount_value?: number
          line_mode: string
          line_no: number
          obligation_held_here?: number
          ordered_qty: number
          overdue_reviewed_at?: string | null
          overdue_reviewed_by?: string | null
          period_count?: number | null
          period_type?: string | null
          physical_returned_qty?: number
          price_overridden?: boolean
          product_id: string
          rental_calculation_type?: string | null
          rental_end_at?: string | null
          rental_start_at?: string | null
          rental_status?: string | null
          return_status?: string
          unit_price: number
          updated_at?: string
        }
        Update: {
          actual_return_at?: string | null
          allocated_qty?: number
          approved_disposition_qty?: number
          approved_lost_qty?: number
          backorder_qty?: number
          base_amount?: number
          bill_id?: string
          cancelled_qty?: number
          carried_forward_qty?: number
          carried_in_qty?: number
          created_at?: string
          created_by?: string
          delivered_qty?: number
          extended_amount?: number
          fulfillment_status?: string
          id?: string
          line_discount_amount?: number
          line_discount_type?: string | null
          line_discount_value?: number
          line_mode?: string
          line_no?: number
          obligation_held_here?: number
          ordered_qty?: number
          overdue_reviewed_at?: string | null
          overdue_reviewed_by?: string | null
          period_count?: number | null
          period_type?: string | null
          physical_returned_qty?: number
          price_overridden?: boolean
          product_id?: string
          rental_calculation_type?: string | null
          rental_end_at?: string | null
          rental_start_at?: string | null
          rental_status?: string | null
          return_status?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_lines_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_lines_overdue_reviewed_by_fkey"
            columns: ["overdue_reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      bills: {
        Row: {
          adjustment_net: number
          balance_due: number
          bill_discount_amount: number
          bill_discount_type: string | null
          bill_discount_value: number
          bill_no: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          charge_total: number
          closed_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          continuation_reason: string | null
          continuation_start_mode: string | null
          created_at: string
          created_by: string
          customer_id: string | null
          delivery_fee: number
          deposit_amount: number
          deposit_note: string | null
          due_date: string | null
          grand_total: number
          id: string
          installation_fee: number
          is_credit_bill: boolean
          note: string | null
          original_bill_id: string | null
          paid_amount: number
          parent_bill_id: string | null
          payment_status: string
          pricing_snapshot: Json
          quotation_id: string | null
          refunded_amount: number
          rental_subtotal: number
          sale_subtotal: number
          service_fee: number
          status: string
          taxable_amount: number
          updated_at: string
          vat_amount: number
          vat_enabled: boolean
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          write_off_total: number
        }
        Insert: {
          adjustment_net?: number
          balance_due?: number
          bill_discount_amount?: number
          bill_discount_type?: string | null
          bill_discount_value?: number
          bill_no?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          charge_total?: number
          closed_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          continuation_reason?: string | null
          continuation_start_mode?: string | null
          created_at?: string
          created_by: string
          customer_id?: string | null
          delivery_fee?: number
          deposit_amount?: number
          deposit_note?: string | null
          due_date?: string | null
          grand_total?: number
          id?: string
          installation_fee?: number
          is_credit_bill?: boolean
          note?: string | null
          original_bill_id?: string | null
          paid_amount?: number
          parent_bill_id?: string | null
          payment_status?: string
          pricing_snapshot?: Json
          quotation_id?: string | null
          refunded_amount?: number
          rental_subtotal?: number
          sale_subtotal?: number
          service_fee?: number
          status?: string
          taxable_amount?: number
          updated_at?: string
          vat_amount?: number
          vat_enabled?: boolean
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          write_off_total?: number
        }
        Update: {
          adjustment_net?: number
          balance_due?: number
          bill_discount_amount?: number
          bill_discount_type?: string | null
          bill_discount_value?: number
          bill_no?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          charge_total?: number
          closed_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          continuation_reason?: string | null
          continuation_start_mode?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string | null
          delivery_fee?: number
          deposit_amount?: number
          deposit_note?: string | null
          due_date?: string | null
          grand_total?: number
          id?: string
          installation_fee?: number
          is_credit_bill?: boolean
          note?: string | null
          original_bill_id?: string | null
          paid_amount?: number
          parent_bill_id?: string | null
          payment_status?: string
          pricing_snapshot?: Json
          quotation_id?: string | null
          refunded_amount?: number
          rental_subtotal?: number
          sale_subtotal?: number
          service_fee?: number
          status?: string
          taxable_amount?: number
          updated_at?: string
          vat_amount?: number
          vat_enabled?: boolean
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          write_off_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "bills_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_balances_v"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "bills_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_original_bill_id_fkey"
            columns: ["original_bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_parent_bill_id_fkey"
            columns: ["parent_bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      charges: {
        Row: {
          amount: number
          basis: Json | null
          bill_id: string
          bill_line_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          charge_type: string
          confirmed_at: string | null
          confirmed_by: string | null
          correlation_id: string
          covered_period_end: string | null
          covered_period_start: string | null
          created_at: string
          created_by: string
          id: string
          incident_case_id: string | null
          reason: string
          status: string
          suggested_amount: number | null
        }
        Insert: {
          amount: number
          basis?: Json | null
          bill_id: string
          bill_line_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          charge_type: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          correlation_id: string
          covered_period_end?: string | null
          covered_period_start?: string | null
          created_at?: string
          created_by: string
          id?: string
          incident_case_id?: string | null
          reason: string
          status?: string
          suggested_amount?: number | null
        }
        Update: {
          amount?: number
          basis?: Json | null
          bill_id?: string
          bill_line_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          charge_type?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          correlation_id?: string
          covered_period_end?: string | null
          covered_period_start?: string | null
          created_at?: string
          created_by?: string
          id?: string
          incident_case_id?: string | null
          reason?: string
          status?: string
          suggested_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "charges_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charges_bill_line_id_fkey"
            columns: ["bill_line_id"]
            isOneToOne: false
            referencedRelation: "bill_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charges_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charges_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charges_incident_case_id_fkey"
            columns: ["incident_case_id"]
            isOneToOne: false
            referencedRelation: "incident_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_documents: {
        Row: {
          created_at: string
          created_by: string
          customer_id: string
          data_snapshot: Json | null
          doc_type: string
          id: string
          note: string | null
          signature_json: Json | null
          signature_svg: string | null
          status: string
          status_reason: string | null
          storage_path: string | null
          template_code: string | null
          template_version: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          customer_id: string
          data_snapshot?: Json | null
          doc_type: string
          id?: string
          note?: string | null
          signature_json?: Json | null
          signature_svg?: string | null
          status?: string
          status_reason?: string | null
          storage_path?: string | null
          template_code?: string | null
          template_version?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          customer_id?: string
          data_snapshot?: Json | null
          doc_type?: string
          id?: string
          note?: string | null
          signature_json?: Json | null
          signature_svg?: string | null
          status?: string
          status_reason?: string | null
          storage_path?: string | null
          template_code?: string | null
          template_version?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_documents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_balances_v"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_documents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_documents_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          account_status: string
          active: boolean
          address: string
          billing_address: string | null
          contact_details: Json
          contact_person: string | null
          created_at: string
          created_by: string
          credit_enabled: boolean
          credit_limit: number
          credit_note: string | null
          customer_code: string | null
          customer_type: string | null
          delivery_address: string | null
          document_reference: string | null
          email: string | null
          id: string
          last_activity_at: string | null
          name: string
          note: string | null
          payment_terms_days: number
          phone: string
          risk_note: string | null
          tags: string[]
          tax_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_status?: string
          active?: boolean
          address: string
          billing_address?: string | null
          contact_details?: Json
          contact_person?: string | null
          created_at?: string
          created_by: string
          credit_enabled?: boolean
          credit_limit?: number
          credit_note?: string | null
          customer_code?: string | null
          customer_type?: string | null
          delivery_address?: string | null
          document_reference?: string | null
          email?: string | null
          id?: string
          last_activity_at?: string | null
          name: string
          note?: string | null
          payment_terms_days?: number
          phone: string
          risk_note?: string | null
          tags?: string[]
          tax_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_status?: string
          active?: boolean
          address?: string
          billing_address?: string | null
          contact_details?: Json
          contact_person?: string | null
          created_at?: string
          created_by?: string
          credit_enabled?: boolean
          credit_limit?: number
          credit_note?: string | null
          customer_code?: string | null
          customer_type?: string | null
          delivery_address?: string | null
          document_reference?: string | null
          email?: string | null
          id?: string
          last_activity_at?: string | null
          name?: string
          note?: string | null
          payment_terms_days?: number
          phone?: string
          risk_note?: string | null
          tags?: string[]
          tax_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          appointment_id: string | null
          bill_id: string
          correlation_id: string
          created_at: string
          created_by: string
          delivered_at: string
          delivered_by: string
          delivery_no: string
          id: string
          note: string | null
        }
        Insert: {
          appointment_id?: string | null
          bill_id: string
          correlation_id: string
          created_at?: string
          created_by: string
          delivered_at: string
          delivered_by: string
          delivery_no: string
          id?: string
          note?: string | null
        }
        Update: {
          appointment_id?: string | null
          bill_id?: string
          correlation_id?: string
          created_at?: string
          created_by?: string
          delivered_at?: string
          delivered_by?: string
          delivery_no?: string
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_delivered_by_fkey"
            columns: ["delivered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_lines: {
        Row: {
          bill_line_id: string
          created_at: string
          created_by: string
          delivery_id: string
          id: string
          product_unit_id: string | null
          quantity: number
        }
        Insert: {
          bill_line_id: string
          created_at?: string
          created_by: string
          delivery_id: string
          id?: string
          product_unit_id?: string | null
          quantity: number
        }
        Update: {
          bill_line_id?: string
          created_at?: string
          created_by?: string
          delivery_id?: string
          id?: string
          product_unit_id?: string | null
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "delivery_lines_bill_line_id_fkey"
            columns: ["bill_line_id"]
            isOneToOne: false
            referencedRelation: "bill_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_lines_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_lines_product_unit_id_fkey"
            columns: ["product_unit_id"]
            isOneToOne: false
            referencedRelation: "product_units"
            referencedColumns: ["id"]
          },
        ]
      }
      document_references: {
        Row: {
          action: string
          copy_number: number
          created_at: string
          created_by: string
          data_snapshot_hash: string | null
          document_no: string | null
          document_type: string
          entity_id: string
          entity_type: string
          format: string
          id: string
        }
        Insert: {
          action: string
          copy_number?: number
          created_at?: string
          created_by: string
          data_snapshot_hash?: string | null
          document_no?: string | null
          document_type: string
          entity_id: string
          entity_type: string
          format: string
          id?: string
        }
        Update: {
          action?: string
          copy_number?: number
          created_at?: string
          created_by?: string
          data_snapshot_hash?: string | null
          document_no?: string | null
          document_type?: string
          entity_id?: string
          entity_type?: string
          format?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_references_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      document_sequences: {
        Row: {
          doc_type: string
          last_no: number
          period_key: string
          prefix: string
          updated_at: string
        }
        Insert: {
          doc_type: string
          last_no?: number
          period_key: string
          prefix: string
          updated_at?: string
        }
        Update: {
          doc_type?: string
          last_no?: number
          period_key?: string
          prefix?: string
          updated_at?: string
        }
        Relationships: []
      }
      expense_entries: {
        Row: {
          amount: number
          category: string
          created_at: string
          created_by: string
          expense_no: string
          id: string
          note: string | null
          paid_method: string
          status: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          created_by: string
          expense_no: string
          id?: string
          note?: string | null
          paid_method: string
          status?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string
          expense_no?: string
          id?: string
          note?: string | null
          paid_method?: string
          status?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_entries_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_ledger_entries: {
        Row: {
          amount: number
          bill_id: string | null
          bill_line_id: string | null
          correlation_id: string
          created_at: string
          created_by: string
          direction: number
          entry_type: string
          id: string
          occurred_at: string
          revenue_class: string | null
          reverses_entry_id: string | null
          source_id: string
          source_type: string
        }
        Insert: {
          amount: number
          bill_id?: string | null
          bill_line_id?: string | null
          correlation_id: string
          created_at?: string
          created_by: string
          direction: number
          entry_type: string
          id?: string
          occurred_at?: string
          revenue_class?: string | null
          reverses_entry_id?: string | null
          source_id: string
          source_type: string
        }
        Update: {
          amount?: number
          bill_id?: string | null
          bill_line_id?: string | null
          correlation_id?: string
          created_at?: string
          created_by?: string
          direction?: number
          entry_type?: string
          id?: string
          occurred_at?: string
          revenue_class?: string | null
          reverses_entry_id?: string | null
          source_id?: string
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_ledger_entries_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_ledger_entries_bill_line_id_fkey"
            columns: ["bill_line_id"]
            isOneToOne: false
            referencedRelation: "bill_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_ledger_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_ledger_entries_reverses_entry_id_fkey"
            columns: ["reverses_entry_id"]
            isOneToOne: true
            referencedRelation: "finance_ledger_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          action: string
          actor_id: string
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string
          request_hash: string
          response: Json | null
          status: string
        }
        Insert: {
          action: string
          actor_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          request_hash: string
          response?: Json | null
          status?: string
        }
        Update: {
          action?: string
          actor_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          request_hash?: string
          response?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "idempotency_keys_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_cases: {
        Row: {
          assessment: Json | null
          bill_id: string
          bill_line_id: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string
          id: string
          incident_type: string
          lost_charge_basis: string | null
          missing_case_id: string | null
          product_unit_id: string | null
          quantity: number
          reason: string | null
          return_line_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assessment?: Json | null
          bill_id: string
          bill_line_id: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by: string
          id?: string
          incident_type: string
          lost_charge_basis?: string | null
          missing_case_id?: string | null
          product_unit_id?: string | null
          quantity: number
          reason?: string | null
          return_line_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assessment?: Json | null
          bill_id?: string
          bill_line_id?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string
          id?: string
          incident_type?: string
          lost_charge_basis?: string | null
          missing_case_id?: string | null
          product_unit_id?: string | null
          quantity?: number
          reason?: string | null
          return_line_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_cases_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_cases_bill_line_id_fkey"
            columns: ["bill_line_id"]
            isOneToOne: false
            referencedRelation: "bill_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_cases_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_cases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_cases_missing_case_id_fkey"
            columns: ["missing_case_id"]
            isOneToOne: false
            referencedRelation: "incident_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_cases_product_unit_id_fkey"
            columns: ["product_unit_id"]
            isOneToOne: false
            referencedRelation: "product_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_cases_return_line_id_fkey"
            columns: ["return_line_id"]
            isOneToOne: false
            referencedRelation: "return_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      member_action_grants: {
        Row: {
          action_code: string
          granted_at: string
          granted_by: string
          user_id: string
        }
        Insert: {
          action_code: string
          granted_at?: string
          granted_by: string
          user_id: string
        }
        Update: {
          action_code?: string
          granted_at?: string
          granted_by?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_action_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_action_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_catalog: {
        Row: {
          code: string
          created_at: string
          label_th: string
          owner_only: boolean
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          label_th: string
          owner_only?: boolean
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          label_th?: string
          owner_only?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          entity_id: string
          entity_type: string
          event_key: string
          event_type: string
          expires_at: string | null
          handled_at: string | null
          handled_by: string | null
          id: string
          read_at: string | null
          recipient_menu: string | null
          recipient_user_id: string | null
          severity: string
          status: string
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          entity_id: string
          entity_type: string
          event_key: string
          event_type: string
          expires_at?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          read_at?: string | null
          recipient_menu?: string | null
          recipient_user_id?: string | null
          severity?: string
          status?: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          event_key?: string
          event_type?: string
          expires_at?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          read_at?: string | null
          recipient_menu?: string | null
          recipient_user_id?: string | null
          severity?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_menu_fkey"
            columns: ["recipient_menu"]
            isOneToOne: false
            referencedRelation: "menu_catalog"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "notifications_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      other_income_entries: {
        Row: {
          amount: number
          category: string
          channel: string
          created_at: string
          created_by: string
          id: string
          income_no: string
          note: string | null
          status: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          category: string
          channel: string
          created_at?: string
          created_by: string
          id?: string
          income_no: string
          note?: string | null
          status?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          category?: string
          channel?: string
          created_at?: string
          created_by?: string
          id?: string
          income_no?: string
          note?: string | null
          status?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "other_income_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "other_income_entries_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_receipts: {
        Row: {
          bill_id: string
          correlation_id: string
          created_at: string
          created_by: string
          id: string
          idempotency_key_id: string
          receipt_no: string
          received_at: string
          received_by: string
          total_amount: number
        }
        Insert: {
          bill_id: string
          correlation_id: string
          created_at?: string
          created_by: string
          id?: string
          idempotency_key_id: string
          receipt_no: string
          received_at?: string
          received_by: string
          total_amount: number
        }
        Update: {
          bill_id?: string
          correlation_id?: string
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key_id?: string
          receipt_no?: string
          received_at?: string
          received_by?: string
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_receipts_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_receipts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_receipts_idempotency_key_id_fkey"
            columns: ["idempotency_key_id"]
            isOneToOne: true
            referencedRelation: "idempotency_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_receipts_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          bill_id: string
          created_at: string
          created_by: string
          id: string
          method: string
          receipt_id: string
          received_at: string
          reference: string | null
          status: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          bill_id: string
          created_at?: string
          created_by: string
          id?: string
          method: string
          receipt_id: string
          received_at: string
          reference?: string | null
          status?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          bill_id?: string
          created_at?: string
          created_by?: string
          id?: string
          method?: string
          receipt_id?: string
          received_at?: string
          reference?: string | null
          status?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "payment_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pin_confirmations: {
        Row: {
          action: string
          created_at: string
          expires_at: string
          id: string
          used_at: string | null
          used_for: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          expires_at: string
          id?: string
          used_at?: string | null
          used_for?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          expires_at?: string
          id?: string
          used_at?: string | null
          used_for?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pin_confirmations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_costs: {
        Row: {
          cost_price: number
          product_id: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          cost_price: number
          product_id: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          cost_price?: number
          product_id?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_costs_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_units: {
        Row: {
          active: boolean
          condition: string
          created_at: string
          created_by: string
          id: string
          product_id: string
          serial_no: string
          unit_state: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          condition?: string
          created_at?: string
          created_by: string
          id?: string
          product_id: string
          serial_no: string
          unit_state?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          condition?: string
          created_at?: string
          created_by?: string
          id?: string
          product_id?: string
          serial_no?: string
          unit_state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_units_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_units_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          calculation_type: string
          can_rent: boolean
          can_sell: boolean
          category_id: string | null
          created_at: string
          created_by: string
          default_damage_fee: number
          default_loss_fee: number
          id: string
          is_accessory: boolean
          is_rent_chargeable: boolean
          item_type: string
          name: string
          rental_price: number | null
          reorder_point: number
          requires_return: boolean
          sale_price: number | null
          sku: string
          unit_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          calculation_type?: string
          can_rent?: boolean
          can_sell?: boolean
          category_id?: string | null
          created_at?: string
          created_by: string
          default_damage_fee?: number
          default_loss_fee?: number
          id?: string
          is_accessory?: boolean
          is_rent_chargeable?: boolean
          item_type?: string
          name: string
          rental_price?: number | null
          reorder_point?: number
          requires_return?: boolean
          sale_price?: number | null
          sku: string
          unit_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          calculation_type?: string
          can_rent?: boolean
          can_sell?: boolean
          category_id?: string | null
          created_at?: string
          created_by?: string
          default_damage_fee?: number
          default_loss_fee?: number
          id?: string
          is_accessory?: boolean
          is_rent_chargeable?: boolean
          item_type?: string
          name?: string
          rental_price?: number | null
          reorder_point?: number
          requires_return?: boolean
          sale_price?: number | null
          sku?: string
          unit_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          first_name: string | null
          id: string
          is_approved: boolean | null
          last_name: string | null
          notification_prefs: Json
          role: string
          status: string
          status_changed_at: string | null
          status_changed_by: string | null
          updated_at: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          first_name?: string | null
          id: string
          is_approved?: boolean | null
          last_name?: string | null
          notification_prefs?: Json
          role?: string
          status?: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          is_approved?: boolean | null
          last_name?: string | null
          notification_prefs?: Json
          role?: string
          status?: string
          status_changed_at?: string | null
          status_changed_by?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_status_changed_by_fkey"
            columns: ["status_changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quotation_items: {
        Row: {
          created_at: string
          created_by: string
          discount_amount: number
          id: string
          line_mode: string
          line_no: number
          line_total: number
          period_count: number | null
          product_id: string
          quantity: number
          quotation_id: string
          rental_calculation_type: string | null
          rental_end_at: string | null
          rental_start_at: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          created_by: string
          discount_amount?: number
          id?: string
          line_mode: string
          line_no: number
          line_total?: number
          period_count?: number | null
          product_id: string
          quantity: number
          quotation_id: string
          rental_calculation_type?: string | null
          rental_end_at?: string | null
          rental_start_at?: string | null
          unit_price: number
        }
        Update: {
          created_at?: string
          created_by?: string
          discount_amount?: number
          id?: string
          line_mode?: string
          line_no?: number
          line_total?: number
          period_count?: number | null
          product_id?: string
          quantity?: number
          quotation_id?: string
          rental_calculation_type?: string | null
          rental_end_at?: string | null
          rental_start_at?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotation_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotation_items_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      quotations: {
        Row: {
          converted_bill_id: string | null
          created_at: string
          created_by: string
          customer_id: string | null
          delivery_fee: number
          deposit_amount: number
          discount_total: number
          document_date: string
          grand_total: number
          id: string
          note: string | null
          pricing_snapshot: Json
          quotation_no: string | null
          site_name: string | null
          status: string
          subtotal: number
          updated_at: string
          updated_by: string | null
          valid_until: string | null
          vat_amount: number
        }
        Insert: {
          converted_bill_id?: string | null
          created_at?: string
          created_by: string
          customer_id?: string | null
          delivery_fee?: number
          deposit_amount?: number
          discount_total?: number
          document_date?: string
          grand_total?: number
          id?: string
          note?: string | null
          pricing_snapshot?: Json
          quotation_no?: string | null
          site_name?: string | null
          status?: string
          subtotal?: number
          updated_at?: string
          updated_by?: string | null
          valid_until?: string | null
          vat_amount?: number
        }
        Update: {
          converted_bill_id?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string | null
          delivery_fee?: number
          deposit_amount?: number
          discount_total?: number
          document_date?: string
          grand_total?: number
          id?: string
          note?: string | null
          pricing_snapshot?: Json
          quotation_no?: string | null
          site_name?: string | null
          status?: string
          subtotal?: number
          updated_at?: string
          updated_by?: string | null
          valid_until?: string | null
          vat_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotations_converted_bill_fk"
            columns: ["converted_bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_balances_v"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "quotations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount: number
          bill_id: string
          correlation_id: string
          created_at: string
          created_by: string
          id: string
          method: string
          paid_at: string
          paid_by: string
          payment_id: string
          reason: string
          refund_no: string
          status: string
        }
        Insert: {
          amount: number
          bill_id: string
          correlation_id: string
          created_at?: string
          created_by: string
          id?: string
          method: string
          paid_at?: string
          paid_by: string
          payment_id: string
          reason: string
          refund_no: string
          status?: string
        }
        Update: {
          amount?: number
          bill_id?: string
          correlation_id?: string
          created_at?: string
          created_by?: string
          id?: string
          method?: string
          paid_at?: string
          paid_by?: string
          payment_id?: string
          reason?: string
          refund_no?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_carry_forward_reversals: {
        Row: {
          carry_forward_id: string
          correlation_id: string
          created_at: string
          created_by: string
          id: string
          reason: string
        }
        Insert: {
          carry_forward_id: string
          correlation_id: string
          created_at?: string
          created_by: string
          id?: string
          reason: string
        }
        Update: {
          carry_forward_id?: string
          correlation_id?: string
          created_at?: string
          created_by?: string
          id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_carry_forward_reversals_carry_forward_id_fkey"
            columns: ["carry_forward_id"]
            isOneToOne: true
            referencedRelation: "rental_carry_forwards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_carry_forward_reversals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_carry_forward_units: {
        Row: {
          carry_forward_id: string
          created_at: string
          created_by: string
          product_unit_id: string
        }
        Insert: {
          carry_forward_id: string
          created_at?: string
          created_by: string
          product_unit_id: string
        }
        Update: {
          carry_forward_id?: string
          created_at?: string
          created_by?: string
          product_unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_carry_forward_units_carry_forward_id_fkey"
            columns: ["carry_forward_id"]
            isOneToOne: false
            referencedRelation: "rental_carry_forwards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_carry_forward_units_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_carry_forward_units_product_unit_id_fkey"
            columns: ["product_unit_id"]
            isOneToOne: false
            referencedRelation: "product_units"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_carry_forwards: {
        Row: {
          correlation_id: string
          created_at: string
          created_by: string
          from_bill_id: string
          from_line_id: string
          id: string
          product_id: string
          quantity: number
          reason: string
          to_bill_id: string
          to_line_id: string
        }
        Insert: {
          correlation_id: string
          created_at?: string
          created_by: string
          from_bill_id: string
          from_line_id: string
          id?: string
          product_id: string
          quantity: number
          reason: string
          to_bill_id: string
          to_line_id: string
        }
        Update: {
          correlation_id?: string
          created_at?: string
          created_by?: string
          from_bill_id?: string
          from_line_id?: string
          id?: string
          product_id?: string
          quantity?: number
          reason?: string
          to_bill_id?: string
          to_line_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_carry_forwards_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_carry_forwards_from_bill_id_fkey"
            columns: ["from_bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_carry_forwards_from_line_id_fkey"
            columns: ["from_line_id"]
            isOneToOne: false
            referencedRelation: "bill_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_carry_forwards_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_carry_forwards_to_bill_id_fkey"
            columns: ["to_bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_carry_forwards_to_line_id_fkey"
            columns: ["to_line_id"]
            isOneToOne: false
            referencedRelation: "bill_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          converted_bill_id: string | null
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          product_id: string
          quantity: number
          quotation_id: string
          release_reason: string | null
          released_at: string | null
          released_by: string | null
          reservation_no: string
          reservation_type: string
          status: string
        }
        Insert: {
          converted_bill_id?: string | null
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          product_id: string
          quantity: number
          quotation_id: string
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          reservation_no: string
          reservation_type: string
          status?: string
        }
        Update: {
          converted_bill_id?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          product_id?: string
          quantity?: number
          quotation_id?: string
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          reservation_no?: string
          reservation_type?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_converted_bill_id_fkey"
            columns: ["converted_bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      return_lines: {
        Row: {
          bill_line_id: string
          condition: string
          created_at: string
          created_by: string
          id: string
          product_unit_id: string | null
          quantity: number
          return_id: string
          to_stock_state: string
        }
        Insert: {
          bill_line_id: string
          condition: string
          created_at?: string
          created_by: string
          id?: string
          product_unit_id?: string | null
          quantity: number
          return_id: string
          to_stock_state: string
        }
        Update: {
          bill_line_id?: string
          condition?: string
          created_at?: string
          created_by?: string
          id?: string
          product_unit_id?: string | null
          quantity?: number
          return_id?: string
          to_stock_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_lines_bill_line_id_fkey"
            columns: ["bill_line_id"]
            isOneToOne: false
            referencedRelation: "bill_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_lines_product_unit_id_fkey"
            columns: ["product_unit_id"]
            isOneToOne: false
            referencedRelation: "product_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_lines_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
        ]
      }
      returns: {
        Row: {
          bill_id: string
          correlation_id: string
          created_at: string
          created_by: string
          id: string
          note: string | null
          received_by: string
          return_no: string
          returned_at: string
        }
        Insert: {
          bill_id: string
          correlation_id: string
          created_at?: string
          created_by: string
          id?: string
          note?: string | null
          received_by: string
          return_no: string
          returned_at: string
        }
        Update: {
          bill_id?: string
          correlation_id?: string
          created_at?: string
          created_by?: string
          id?: string
          note?: string | null
          received_by?: string
          return_no?: string
          returned_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "returns_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_balances: {
        Row: {
          product_id: string
          quantity: number
          stock_state: string
          updated_at: string
        }
        Insert: {
          product_id: string
          quantity?: number
          stock_state: string
          updated_at?: string
        }
        Update: {
          product_id?: string
          quantity?: number
          stock_state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_count_lines: {
        Row: {
          adjustment_correlation: string | null
          counted_qty: number | null
          created_at: string
          created_by: string
          discrepancy: number | null
          id: string
          product_id: string
          reason: string | null
          snapshot_qty: number
          stock_count_id: string
          stock_state: string
          updated_at: string
        }
        Insert: {
          adjustment_correlation?: string | null
          counted_qty?: number | null
          created_at?: string
          created_by: string
          discrepancy?: number | null
          id?: string
          product_id: string
          reason?: string | null
          snapshot_qty: number
          stock_count_id: string
          stock_state?: string
          updated_at?: string
        }
        Update: {
          adjustment_correlation?: string | null
          counted_qty?: number | null
          created_at?: string
          created_by?: string
          discrepancy?: number | null
          id?: string
          product_id?: string
          reason?: string | null
          snapshot_qty?: number
          stock_count_id?: string
          stock_state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_count_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_lines_stock_count_id_fkey"
            columns: ["stock_count_id"]
            isOneToOne: false
            referencedRelation: "stock_counts"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_counts: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          count_no: string
          created_at: string
          created_by: string
          id: string
          note: string | null
          snapshot_at: string
          status: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          count_no: string
          created_at?: string
          created_by: string
          id?: string
          note?: string | null
          snapshot_at?: string
          status?: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          count_no?: string
          created_at?: string
          created_by?: string
          id?: string
          note?: string | null
          snapshot_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_counts_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          correlation_id: string
          created_at: string
          created_by: string | null
          id: string
          movement_type: string
          product_id: string
          product_unit_id: string | null
          quantity_delta: number
          reason: string | null
          reverses_movement_id: string | null
          source_id: string
          source_type: string
          stock_state: string
        }
        Insert: {
          correlation_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          movement_type: string
          product_id: string
          product_unit_id?: string | null
          quantity_delta: number
          reason?: string | null
          reverses_movement_id?: string | null
          source_id: string
          source_type: string
          stock_state: string
        }
        Update: {
          correlation_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          movement_type?: string
          product_id?: string
          product_unit_id?: string | null
          quantity_delta?: number
          reason?: string | null
          reverses_movement_id?: string | null
          source_id?: string
          source_type?: string
          stock_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_unit_id_fkey"
            columns: ["product_unit_id"]
            isOneToOne: false
            referencedRelation: "product_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_reverses_movement_id_fkey"
            columns: ["reverses_movement_id"]
            isOneToOne: true
            referencedRelation: "stock_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      store_settings: {
        Row: {
          address: string | null
          company_name: string | null
          doc_number_formats: Json
          id: string
          logo_url: string | null
          phone: string | null
          policies: Json
          singleton: boolean
          tax_id: string | null
          timezone: string
          updated_at: string
          updated_by: string | null
          vat_enabled: boolean
          vat_mode: string | null
          vat_rate: number | null
        }
        Insert: {
          address?: string | null
          company_name?: string | null
          doc_number_formats?: Json
          id?: string
          logo_url?: string | null
          phone?: string | null
          policies?: Json
          singleton?: boolean
          tax_id?: string | null
          timezone?: string
          updated_at?: string
          updated_by?: string | null
          vat_enabled?: boolean
          vat_mode?: string | null
          vat_rate?: number | null
        }
        Update: {
          address?: string | null
          company_name?: string | null
          doc_number_formats?: Json
          id?: string
          logo_url?: string | null
          phone?: string | null
          policies?: Json
          singleton?: boolean
          tax_id?: string | null
          timezone?: string
          updated_at?: string
          updated_by?: string | null
          vat_enabled?: boolean
          vat_mode?: string | null
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "store_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "units_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_menu_access: {
        Row: {
          granted_at: string
          granted_by: string
          menu_code: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by: string
          menu_code: string
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string
          menu_code?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_menu_access_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_menu_access_menu_code_fkey"
            columns: ["menu_code"]
            isOneToOne: false
            referencedRelation: "menu_catalog"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "user_menu_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_pins: {
        Row: {
          auto_lock_seconds: number | null
          blocked_at: string | null
          created_at: string
          failed_attempts: number
          locked_until: string | null
          pin_hash: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_lock_seconds?: number | null
          blocked_at?: string | null
          created_at?: string
          failed_attempts?: number
          locked_until?: string | null
          pin_hash?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_lock_seconds?: number | null
          blocked_at?: string | null
          created_at?: string
          failed_attempts?: number
          locked_until?: string | null
          pin_hash?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_pins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      write_offs: {
        Row: {
          amount: number
          bill_id: string
          charge_id: string | null
          correlation_id: string
          created_at: string
          created_by: string
          id: string
          incident_case_id: string | null
          reason: string
        }
        Insert: {
          amount: number
          bill_id: string
          charge_id?: string | null
          correlation_id: string
          created_at?: string
          created_by: string
          id?: string
          incident_case_id?: string | null
          reason: string
        }
        Update: {
          amount?: number
          bill_id?: string
          charge_id?: string | null
          correlation_id?: string
          created_at?: string
          created_by?: string
          id?: string
          incident_case_id?: string | null
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "write_offs_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "write_offs_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "write_offs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "write_offs_incident_case_id_fkey"
            columns: ["incident_case_id"]
            isOneToOne: false
            referencedRelation: "incident_cases"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      customer_balances_v: {
        Row: {
          available_credit: number | null
          credit_enabled: boolean | null
          credit_limit: number | null
          current_balance: number | null
          customer_id: string | null
          overdue_balance: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _audit: {
        Args: {
          p_action: string
          p_after: Json
          p_amount?: number
          p_before: Json
          p_channel?: string
          p_correlation_id: string
          p_entity_id: string
          p_entity_type: string
          p_pin_verified?: boolean
          p_quantity?: number
          p_reason: string
          p_result?: string
        }
        Returns: undefined
      }
      _bill_compute_totals: { Args: { p_bill_id: string }; Returns: undefined }
      _bill_grand_for_subtotal: {
        Args: { p_bill_id: string; p_subtotal: number }
        Returns: number
      }
      _bill_post_revenue: {
        Args: { p_bill_id: string; p_correlation_id: string }
        Returns: undefined
      }
      _bill_recalculate: { Args: { p_bill_id: string }; Returns: undefined }
      _bill_release_allocation: {
        Args: { p_bill_id: string; p_correlation_id: string }
        Returns: undefined
      }
      _bill_settle: { Args: { p_bill_id: string }; Returns: undefined }
      _bill_try_close: { Args: { p_bill_id: string }; Returns: boolean }
      _check_price: {
        Args: { p_mode: string; p_product_id: string; p_unit_price: number }
        Returns: number
      }
      _discount_over_limit: {
        Args: { p_base: number; p_discount: number }
        Returns: boolean
      }
      _doc_default_prefix: { Args: { p_doc_type: string }; Returns: string }
      _doc_format: {
        Args: { p_doc_type: string }
        Returns: Record<string, unknown>
      }
      _early_return_credit: { Args: { p_return_id: string }; Returns: number }
      _format_document_no: {
        Args: {
          p_digits: number
          p_local_date: string
          p_no: number
          p_prefix: string
        }
        Returns: string
      }
      _idempotency_begin: {
        Args: { p_action: string; p_key: string; p_request_hash: string }
        Returns: Record<string, unknown>
      }
      _idempotency_finish: {
        Args: { p_key_id: string; p_response: Json }
        Returns: Json
      }
      _ledger: {
        Args: {
          p_amount: number
          p_bill_id: string
          p_class: string
          p_correlation_id: string
          p_direction: number
          p_entry_type: string
          p_line_id: string
          p_source_id: string
          p_source_type: string
        }
        Returns: undefined
      }
      _ledger_reverse_source: {
        Args: {
          p_correlation_id: string
          p_source_id: string
          p_source_type: string
        }
        Returns: undefined
      }
      _line_recalculate: { Args: { p_line_id: string }; Returns: undefined }
      _list_price: {
        Args: { p_mode: string; p_product_id: string }
        Returns: number
      }
      _local_date: { Args: { p_ts: string }; Returns: string }
      _next_document_no: { Args: { p_doc_type: string }; Returns: string }
      _next_document_no_at: {
        Args: { p_at: string; p_doc_type: string }
        Returns: string
      }
      _notify: {
        Args: {
          p_body: string
          p_entity_id: string
          p_entity_type: string
          p_event_key: string
          p_event_type: string
          p_recipient_menu: string
          p_recipient_user: string
          p_severity: string
          p_title: string
        }
        Returns: undefined
      }
      _payment_receive_core: {
        Args: {
          p_bill_id: string
          p_correlation_id: string
          p_key_id: string
          p_tenders: Json
          p_received_on?: string
        }
        Returns: Json
      }
      _policy: { Args: { p_default: Json; p_key: string }; Returns: Json }
      _require_action: { Args: { p_code: string }; Returns: undefined }
      _require_active_member: { Args: never; Returns: undefined }
      _require_menu: { Args: { p_codes: string[] }; Returns: undefined }
      _require_owner: { Args: never; Returns: undefined }
      _require_pin: {
        Args: { p_action: string; p_token: string }
        Returns: undefined
      }
      _require_reason: { Args: { p_reason: string }; Returns: string }
      _reservation_release: {
        Args: {
          p_correlation_id: string
          p_reason: string
          p_reservation_id: string
          p_status: string
        }
        Returns: undefined
      }
      _stock_move: {
        Args: {
          p_correlation_id: string
          p_from_state: string
          p_movement_type: string
          p_product_id: string
          p_qty: number
          p_reason: string
          p_source_id: string
          p_source_type: string
          p_to_state: string
          p_unit_id: string
        }
        Returns: undefined
      }
      _store_settings: {
        Args: never
        Returns: {
          address: string | null
          company_name: string | null
          doc_number_formats: Json
          id: string
          logo_url: string | null
          phone: string | null
          policies: Json
          singleton: boolean
          tax_id: string | null
          timezone: string
          updated_at: string
          updated_by: string | null
          vat_enabled: boolean
          vat_mode: string | null
          vat_rate: number | null
        }
        SetofOptions: {
          from: "*"
          to: "store_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _unit_holder_line: { Args: { p_unit_id: string }; Returns: string }
      _unit_state_for: { Args: { p_stock_state: string }; Returns: string }
      _unit_transition: {
        Args: {
          p_expected: string[]
          p_new_state: string
          p_product_id: string
          p_unit_id: string
        }
        Returns: undefined
      }
      appointment_reschedule: {
        Args: {
          p_appointment_id: string
          p_new_end: string
          p_new_start: string
          p_reason: string
        }
        Returns: Json
      }
      appointment_save: {
        Args: { p_appointment_id: string; p_data: Json }
        Returns: Json
      }
      appointment_set_status: {
        Args: { p_appointment_id: string; p_reason?: string; p_status: string }
        Returns: Json
      }
      bill_adjust: {
        Args: {
          p_adjustment_type: string
          p_amount: number
          p_bill_id: string
          p_bill_line_id?: string
          p_idempotency_key: string
          p_pin_token: string
          p_reason: string
          p_reverses_adjustment_id?: string
        }
        Returns: Json
      }
      bill_allocate_backorder: { Args: { p_bill_id: string }; Returns: Json }
      bill_cancel: {
        Args: { p_bill_id: string; p_pin_token?: string; p_reason: string }
        Returns: Json
      }
      bill_confirm: {
        Args: { p_bill_id: string; p_idempotency_key: string; p_tenders?: Json }
        Returns: Json
      }
      bill_correct: {
        Args: {
          p_bill_id: string
          p_data: Json
          p_pin_token: string
          p_reason: string
        }
        Returns: Json
      }
      bill_refund_suggestion: { Args: { p_bill_id: string }; Returns: Json }
      bill_save_draft: {
        Args: { p_bill_id: string; p_data: Json; p_pin_token?: string }
        Returns: Json
      }
      bill_void: {
        Args: { p_bill_id: string; p_pin_token: string; p_reason: string }
        Returns: Json
      }
      bootstrap_owner: { Args: { p_username: string }; Returns: string }
      charge_cancel: {
        Args: { p_charge_id: string; p_pin_token?: string; p_reason: string }
        Returns: Json
      }
      charge_confirm: { Args: { p_charge_id: string }; Returns: Json }
      charge_create: {
        Args: {
          p_amount: number
          p_basis?: Json
          p_bill_id: string
          p_bill_line_id?: string
          p_charge_type: string
          p_incident_case_id?: string
          p_period_end?: string
          p_period_start?: string
          p_pin_token?: string
          p_reason: string
        }
        Returns: Json
      }
      convert_damaged_stock: {
        Args: {
          p_from_product_id: string
          p_from_quantity: number
          p_idempotency_key: string
          p_pin_token: string
          p_reason: string
          p_to_product_id: string
          p_to_quantity: number
        }
        Returns: Json
      }
      create_rental_continuation: {
        Args: {
          p_idempotency_key: string
          p_items: Json
          p_parent_bill_id: string
          p_pin_token?: string
          p_reason: string
          p_start_mode?: string
        }
        Returns: Json
      }
      customer_create: {
        Args: { p_confirm_duplicate?: boolean; p_data: Json }
        Returns: Json
      }
      customer_document_save: {
        Args: { p_customer_id: string; p_data: Json; p_document_id: string }
        Returns: Json
      }
      customer_document_set_status: {
        Args: { p_document_id: string; p_reason: string; p_status: string }
        Returns: Json
      }
      customer_set_active: {
        Args: { p_active: boolean; p_customer_id: string; p_reason: string }
        Returns: Json
      }
      customer_update: {
        Args: { p_customer_id: string; p_data: Json; p_reason?: string }
        Returns: Json
      }
      delivery_create: {
        Args: {
          p_appointment_id?: string
          p_bill_id: string
          p_delivered_at?: string
          p_idempotency_key: string
          p_lines: Json
          p_note?: string
        }
        Returns: Json
      }
      document_number_preview: {
        Args: { p_digits?: number; p_doc_type: string; p_prefix?: string }
        Returns: string
      }
      document_reference_log: {
        Args: {
          p_action: string
          p_copy_number?: number
          p_document_no?: string
          p_document_type: string
          p_entity_id: string
          p_entity_type: string
          p_format: string
          p_snapshot_hash?: string
        }
        Returns: Json
      }
      expense_create: {
        Args: {
          p_amount: number
          p_category: string
          p_note: string
          p_paid_method: string
          p_pin_token: string
        }
        Returns: Json
      }
      expense_void: {
        Args: { p_expense_id: string; p_pin_token: string; p_reason: string }
        Returns: Json
      }
      has_menu: { Args: { p_code: string }; Returns: boolean }
      incident_assess: {
        Args: {
          p_assessment: Json
          p_case_id: string
          p_note?: string
          p_status: string
        }
        Returns: Json
      }
      incident_mark_found: {
        Args: { p_case_id: string; p_reason: string }
        Returns: Json
      }
      incident_open: {
        Args: {
          p_bill_line_id: string
          p_quantity: number
          p_reason: string
          p_type: string
          p_unit_id?: string
        }
        Returns: Json
      }
      incident_resolve: {
        Args: {
          p_case_id: string
          p_pin_token?: string
          p_reason: string
          p_reject?: boolean
        }
        Returns: Json
      }
      is_active_member: { Args: never; Returns: boolean }
      is_owner: { Args: never; Returns: boolean }
      lost_record: {
        Args: {
          p_lost_charge_basis: string
          p_missing_case_id: string
          p_pin_token: string
          p_quantity: number
          p_reason: string
        }
        Returns: Json
      }
      my_notification_prefs_set: { Args: { p_prefs: Json }; Returns: Json }
      my_pin_status: { Args: never; Returns: Json }
      notification_mark: {
        Args: { p_notification_id: string; p_status: string }
        Returns: Json
      }
      other_income_create: {
        Args: {
          p_amount: number
          p_category: string
          p_channel: string
          p_note?: string
        }
        Returns: Json
      }
      other_income_void: {
        Args: { p_income_id: string; p_pin_token: string; p_reason: string }
        Returns: Json
      }
      overdue_review: {
        Args: { p_bill_line_id: string; p_note: string }
        Returns: Json
      }
      owner_recover_pin: { Args: { p_new_pin: string }; Returns: Json }
      owner_reset_member_pin: {
        Args: { p_reason: string; p_user_id: string }
        Returns: Json
      }
      owner_set_member_actions: {
        Args: { p_actions: string[]; p_reason: string; p_user_id: string }
        Returns: Json
      }
      owner_set_member_menus: {
        Args: { p_menus: string[]; p_reason: string; p_user_id: string }
        Returns: Json
      }
      owner_set_member_role: {
        Args: { p_reason: string; p_role: string; p_user_id: string }
        Returns: Json
      }
      owner_set_member_status: {
        Args: { p_reason: string; p_status: string; p_user_id: string }
        Returns: Json
      }
      payment_receive: {
        Args: {
          p_bill_id: string
          p_idempotency_key: string
          p_received_on?: string
          p_tenders: Json
        }
        Returns: Json
      }
      payment_void: {
        Args: { p_payment_id: string; p_pin_token: string; p_reason: string }
        Returns: Json
      }
      product_category_save: {
        Args: { p_active?: boolean; p_category_id: string; p_name: string }
        Returns: Json
      }
      product_create: {
        Args: {
          p_confirm_duplicate?: boolean
          p_cost_price?: number
          p_data: Json
          p_initial_qty?: number
          p_pin_token?: string
        }
        Returns: Json
      }
      product_set_active: {
        Args: { p_active: boolean; p_product_id: string; p_reason: string }
        Returns: Json
      }
      product_set_cost: {
        Args: { p_cost_price: number; p_product_id: string; p_reason: string }
        Returns: Json
      }
      product_set_price: {
        Args: {
          p_pin_token: string
          p_product_id: string
          p_reason: string
          p_rental_price: number
          p_sale_price: number
        }
        Returns: Json
      }
      product_unit_register: {
        Args: { p_product_id: string; p_reason: string; p_serial_no: string }
        Returns: Json
      }
      product_update: {
        Args: { p_data: Json; p_product_id: string; p_reason?: string }
        Returns: Json
      }
      quotation_save_draft: {
        Args: { p_data: Json; p_pin_token?: string; p_quotation_id: string }
        Returns: Json
      }
      quotation_send: { Args: { p_quotation_id: string }; Returns: Json }
      quotation_set_status: {
        Args: { p_quotation_id: string; p_reason?: string; p_status: string }
        Returns: Json
      }
      reconcile_bill: { Args: { p_bill_id: string }; Returns: Json }
      reconcile_stock_balances: {
        Args: never
        Returns: {
          cached: number
          ledger: number
          product_id: string
          stock_state: string
        }[]
      }
      refund_pay: {
        Args: {
          p_amount: number
          p_bill_id: string
          p_idempotency_key: string
          p_method: string
          p_payment_id?: string
          p_pin_token: string
          p_reason: string
        }
        Returns: Json
      }
      rental_overdue_scan: { Args: never; Returns: number }
      reservation_create: {
        Args: {
          p_expires_at: string
          p_idempotency_key: string
          p_items: Json
          p_quotation_id: string
        }
        Returns: Json
      }
      reservation_release: {
        Args: { p_reason: string; p_reservation_id: string }
        Returns: Json
      }
      reservations_expire: { Args: never; Returns: number }
      return_receive: {
        Args: {
          p_bill_id: string
          p_idempotency_key: string
          p_lines: Json
          p_note?: string
          p_returned_at?: string
        }
        Returns: Json
      }
      reverse_carry_forward: {
        Args: {
          p_carry_forward_id: string
          p_pin_token: string
          p_reason: string
        }
        Returns: Json
      }
      set_auto_lock: { Args: { p_seconds: number }; Returns: Json }
      set_pin: {
        Args: { p_new_pin: string; p_pin_token?: string }
        Returns: Json
      }
      settings_update: {
        Args: { p_patch: Json; p_reason: string }
        Returns: Json
      }
      stock_adjust: {
        Args: {
          p_from_state: string
          p_idempotency_key: string
          p_pin_token: string
          p_product_id: string
          p_quantity: number
          p_reason: string
          p_to_state: string
          p_unit_id?: string
        }
        Returns: Json
      }
      stock_count_confirm: {
        Args: { p_count_id: string; p_pin_token: string }
        Returns: Json
      }
      stock_count_open: { Args: { p_note?: string }; Returns: Json }
      stock_count_record: {
        Args: { p_count_id: string; p_lines: Json }
        Returns: Json
      }
      stock_receive: {
        Args: {
          p_idempotency_key: string
          p_pin_token: string
          p_product_id: string
          p_quantity: number
          p_reason: string
        }
        Returns: Json
      }
      unit_save: {
        Args: {
          p_active?: boolean
          p_name: string
          p_sort_order?: number
          p_unit_id: string
        }
        Returns: Json
      }
      verify_pin: {
        Args: { p_action?: string; p_pin: string; p_purpose?: string }
        Returns: Json
      }
      write_off_record: {
        Args: {
          p_amount: number
          p_bill_id: string
          p_charge_id?: string
          p_incident_case_id?: string
          p_pin_token: string
          p_reason: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
