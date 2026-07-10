export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type Table<Row, Insert = Partial<Row>, Update = Partial<Insert>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export interface Database {
  public: {
    Tables: {
      profiles: Table<{
        id: string
        full_name: string
        role: 'admin' | 'receptionist' | 'doctor' | 'therapist' | 'follow_up_agent'
        created_at: string
      }>
      doctors: Table<{
        id: string
        name: string
        specialization: string | null
        is_active: boolean
        created_at: string
      }>
      patients: Table<{
        id: string
        full_name: string
        age: number
        gender: 'male' | 'female' | 'other'
        phone: string
        address: string | null
        father_name: string | null
        referral_source: string | null
        blood_group: string | null
        created_at: string
        updated_at: string
      }>
      visits: {
        Row: {
          id: string
          patient_id: string
          doctor_id: string | null
          token_number: number
          token_date: string
          chief_complaint: string
          consultation_date: string
          consultation_time: string
          visit_type: 'first_visit' | 'follow_up'
          status: 'pending' | 'completed' | 'cancelled'
          notes: string | null
          prescription: string | null
          registered_by: 'self' | 'receptionist'
          payment_method: 'cash' | 'online' | null
          payment_method_locked_at: string | null
          payment_method_override_by: string | null
          payment_method_override_reason: string | null
          confirmation_token: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          patient_id: string
          doctor_id?: string | null
          token_number: number
          token_date?: string
          chief_complaint: string
          consultation_date?: string
          consultation_time?: string
          visit_type?: 'first_visit' | 'follow_up'
          status?: 'pending' | 'completed' | 'cancelled'
          notes?: string | null
          prescription?: string | null
          registered_by?: 'self' | 'receptionist'
          payment_method?: 'cash' | 'online' | null
          payment_method_locked_at?: string | null
          payment_method_override_by?: string | null
          payment_method_override_reason?: string | null
          confirmation_token?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['visits']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'visits_patient_id_fkey'
            columns: ['patient_id']
            isOneToOne: false
            referencedRelation: 'patients'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'visits_doctor_id_fkey'
            columns: ['doctor_id']
            isOneToOne: false
            referencedRelation: 'doctors'
            referencedColumns: ['id']
          },
        ]
      }
      token_counters: Table<{
        id: string
        counter_date: string
        last_token: number
      }>
      invoices: {
        Row: {
          id: string
          visit_id: string
          patient_id: string
          invoice_number: string
          line_items: Array<{ id: string; name: string; quantity: number; amount: number }>
          subtotal: number
          discount: number
          total: number
          payment_status: 'pending' | 'paid_cash' | 'paid_online'
          payment_method: 'cash' | 'online_upi' | null
          paid_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          visit_id: string
          patient_id: string
          invoice_number: string
          line_items?: Array<{ id: string; name: string; quantity: number; amount: number }>
          subtotal?: number
          discount?: number
          total?: number
          payment_status?: 'pending' | 'paid_cash' | 'paid_online'
          payment_method?: 'cash' | 'online_upi' | null
          paid_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['invoices']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'invoices_visit_id_fkey'
            columns: ['visit_id']
            isOneToOne: true
            referencedRelation: 'visits'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'invoices_patient_id_fkey'
            columns: ['patient_id']
            isOneToOne: false
            referencedRelation: 'patients'
            referencedColumns: ['id']
          },
        ]
      }
      patient_packages: {
        Row: {
          id: string
          patient_id: string
          visit_id: string | null
          template_id: string | null
          package_name: string
          total_sessions: number
          quoted_amount: number
          created_by: string | null
          status: 'active' | 'completed' | 'cancelled'
          created_at: string
        }
        Insert: {
          id?: string
          patient_id: string
          visit_id?: string | null
          template_id?: string | null
          package_name: string
          total_sessions: number
          quoted_amount: number
          created_by?: string | null
          status?: 'active' | 'completed' | 'cancelled'
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['patient_packages']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'patient_packages_patient_id_fkey'
            columns: ['patient_id']
            isOneToOne: false
            referencedRelation: 'patients'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'patient_packages_visit_id_fkey'
            columns: ['visit_id']
            isOneToOne: false
            referencedRelation: 'visits'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'patient_packages_template_id_fkey'
            columns: ['template_id']
            isOneToOne: false
            referencedRelation: 'package_templates'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'patient_packages_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      package_templates: {
        Row: {
          id: string
          name: string
          total_sessions: number
          default_price: number
          is_active: boolean
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          total_sessions: number
          default_price: number
          is_active?: boolean
          created_by?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['package_templates']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'package_templates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      payment_transactions: {
        Row: {
          id: string
          patient_id: string
          patient_package_id: string | null
          visit_id: string | null
          amount: number
          payment_method: 'cash' | 'online'
          recorded_by: string | null
          is_correction: boolean
          correction_reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          patient_id: string
          patient_package_id?: string | null
          visit_id?: string | null
          amount: number
          payment_method: 'cash' | 'online'
          recorded_by?: string | null
          is_correction?: boolean
          correction_reason?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['payment_transactions']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'payment_transactions_patient_id_fkey'
            columns: ['patient_id']
            isOneToOne: false
            referencedRelation: 'patients'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'payment_transactions_patient_package_id_fkey'
            columns: ['patient_package_id']
            isOneToOne: false
            referencedRelation: 'patient_packages'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'payment_transactions_visit_id_fkey'
            columns: ['visit_id']
            isOneToOne: false
            referencedRelation: 'visits'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'payment_transactions_recorded_by_fkey'
            columns: ['recorded_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      whatsapp_notifications: {
        Row: {
          id: string
          patient_id: string
          notification_type:
            | 'registration_confirmation'
            | 'payment_receipt'
            | 'session_reminder'
            | 'follow_up'
            | 'portal_link'
          payload: Json
          status: 'queued' | 'sent' | 'failed'
          meta_message_id: string | null
          error_message: string | null
          created_at: string
        }
        Insert: {
          id?: string
          patient_id: string
          notification_type:
            | 'registration_confirmation'
            | 'payment_receipt'
            | 'session_reminder'
            | 'follow_up'
            | 'portal_link'
          payload: Json
          status?: 'queued' | 'sent' | 'failed'
          meta_message_id?: string | null
          error_message?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['whatsapp_notifications']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'whatsapp_notifications_patient_id_fkey'
            columns: ['patient_id']
            isOneToOne: false
            referencedRelation: 'patients'
            referencedColumns: ['id']
          },
        ]
      }
      package_sessions: {
        Row: {
          id: string
          patient_package_id: string
          session_date: string
          marked_by: string | null
          marked_at: string
          is_voided: boolean
          void_reason: string | null
          notes: string | null
        }
        Insert: {
          id?: string
          patient_package_id: string
          session_date?: string
          marked_by?: string | null
          marked_at?: string
          is_voided?: boolean
          void_reason?: string | null
          notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['package_sessions']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'package_sessions_patient_package_id_fkey'
            columns: ['patient_package_id']
            isOneToOne: false
            referencedRelation: 'patient_packages'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'package_sessions_marked_by_fkey'
            columns: ['marked_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      patient_portal_links: {
        Row: {
          id: string
          patient_id: string
          token: string
          created_at: string
          revoked_at: string | null
          last_accessed_at: string | null
        }
        Insert: {
          id?: string
          patient_id: string
          token?: string
          created_at?: string
          revoked_at?: string | null
          last_accessed_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['patient_portal_links']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'patient_portal_links_patient_id_fkey'
            columns: ['patient_id']
            isOneToOne: false
            referencedRelation: 'patients'
            referencedColumns: ['id']
          },
        ]
      }
      follow_up_tasks: {
        Row: {
          id: string
          patient_id: string
          patient_package_id: string
          reason: 'missed_expected_session' | 'discontinued_early'
          assigned_to: string | null
          status: 'pending' | 'contacted' | 'resolved'
          outcome: 'rescheduled' | 'discontinued_reason' | 'no_answer' | null
          outcome_notes: string | null
          created_at: string
          resolved_at: string | null
        }
        Insert: {
          id?: string
          patient_id: string
          patient_package_id: string
          reason: 'missed_expected_session' | 'discontinued_early'
          assigned_to?: string | null
          status?: 'pending' | 'contacted' | 'resolved'
          outcome?: 'rescheduled' | 'discontinued_reason' | 'no_answer' | null
          outcome_notes?: string | null
          created_at?: string
          resolved_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['follow_up_tasks']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'follow_up_tasks_patient_id_fkey'
            columns: ['patient_id']
            isOneToOne: false
            referencedRelation: 'patients'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'follow_up_tasks_patient_package_id_fkey'
            columns: ['patient_package_id']
            isOneToOne: false
            referencedRelation: 'patient_packages'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'follow_up_tasks_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      charge_presets: Table<{
        id: string
        name: string
        amount: number
        category: string
        is_active: boolean
        created_at: string
      }>
      clinic_settings: Table<{
        id: number
        clinic_name: string
        address: string
        phone: string
        doctor_name: string
        registration_number: string
        website_url: string
        logo_url: string
        theme_color: string
        theme_color_hover: string
        theme_color_light: string
        working_hours_start: string
        working_hours_end: string
        working_days: number[]
        working_schedule: Json
        timezone: string
        created_at: string
        updated_at: string
      }>
      audit_logs: Table<{
        id: number
        actor_id: string | null
        table_name: string
        record_id: string | null
        action: 'INSERT' | 'UPDATE' | 'DELETE'
        created_at: string
      }>
    }
    Views: Record<string, never>
    Functions: {
      get_next_token: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      generate_invoice_number: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      register_patient_atomic: {
        Args: {
          p_full_name: string
          p_age: number
          p_gender: string
          p_phone: string
          p_chief_complaint: string
          p_doctor_id?: string | null
          p_address?: string | null
          p_father_name?: string | null
          p_referral_source?: 'google' | 'youtube' | 'social_media' | 'friend_family' | 'doctor_referral' | 'walk_in' | 'other' | null
          p_visit_type?: 'first_visit' | 'follow_up'
          p_consultation_date?: string
          p_consultation_time?: string
          p_registered_by?: string
          p_request_hash?: string | null
          p_payment_method?: 'cash' | 'online' | null
        }
        Returns: Array<{
          token_number: number
          visit_id: string
          patient_name: string
          confirmation_token: string
          duplicate_registration: boolean
        }>
      }
      override_payment_method_atomic: {
        Args: {
          p_visit_id: string
          p_new_method: 'cash' | 'online'
          p_reason: string
          p_admin_id: string
        }
        Returns: Array<{
          id: string
          patient_id: string
          payment_method: 'cash' | 'online'
          payment_method_locked_at: string
          payment_method_override_by: string
          payment_method_override_reason: string
          updated_at: string
        }>
      }
      create_invoice_for_visit: {
        Args: {
          p_visit_id: string
        }
        Returns: Array<{
          id: string
          visit_id: string
          patient_id: string
          invoice_number: string
          line_items: Json
          subtotal: number
          discount: number
          total: number
          payment_status: 'pending' | 'paid_cash' | 'paid_online'
          payment_method: 'cash' | 'online_upi' | null
          paid_at: string | null
          created_at: string
          updated_at: string
        }>
      }
      create_patient_package_atomic: {
        Args: {
          p_patient_id: string
          p_visit_id?: string | null
          p_package_name?: string | null
          p_total_sessions?: number | null
          p_quoted_amount?: number | null
          p_template_id?: string | null
        }
        Returns: Array<{
          id: string
          patient_id: string
          visit_id: string | null
          template_id: string | null
          package_name: string
          total_sessions: number
          quoted_amount: number
          created_by: string | null
          status: 'active' | 'completed' | 'cancelled'
          created_at: string
        }>
      }
      record_payment_atomic: {
        Args: {
          p_patient_id: string
          p_patient_package_id?: string | null
          p_visit_id?: string | null
          p_amount?: number | null
          p_payment_method?: 'cash' | 'online' | null
        }
        Returns: Array<{
          payment_transaction_id: string
          patient_package_id: string | null
          paid_total: number
          balance: number | null
        }>
      }
      close_cash_shift_atomic: {
        Args: {
          p_counted_cash: number
          p_notes?: string | null
          p_closed_by?: string | null
          p_shift_date?: string
        }
        Returns: Array<{
          id: string
          shift_date: string
          system_cash_total: number
          counted_cash: number
          variance: number
          notes: string | null
          closed_by: string | null
          created_at: string
        }>
      }
      detect_follow_up_tasks_atomic: {
        Args: Record<PropertyKey, never>
        Returns: Array<{
          inserted_count: number
        }>
      }
      mark_session_atomic: {
        Args: {
          p_patient_package_id: string
          p_marked_by: string
        }
        Returns: Array<{
          session_id: string
          patient_package_id: string
          patient_id: string
          package_name: string
          total_sessions: number
          sessions_used: number
          sessions_remaining: number
        }>
      }
      void_package_session_atomic: {
        Args: {
          p_session_id: string
          p_reason: string
          p_admin_id: string
        }
        Returns: Array<{
          id: string
          patient_package_id: string
          is_voided: boolean
          void_reason: string | null
          marked_at: string
        }>
      }
      get_patient_portal_overview: {
        Args: {
          p_token: string
        }
        Returns: Array<{
          patient_id: string
          patient_name: string
          package_id: string | null
          package_name: string | null
          status: 'active' | 'completed' | 'cancelled' | null
          total_sessions: number | null
          sessions_used: number
          sessions_remaining: number
          quoted_amount: number | null
          paid_total: number
          balance: number
          payment_history: Json
        }>
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
