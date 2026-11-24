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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admin_activity_logs: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          details: Json | null
          id: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      admin_notes: {
        Row: {
          admin_id: string
          admin_name: string
          created_at: string
          customer_id: string
          id: string
          note: string
        }
        Insert: {
          admin_id: string
          admin_name?: string
          created_at?: string
          customer_id: string
          id?: string
          note: string
        }
        Update: {
          admin_id?: string
          admin_name?: string
          created_at?: string
          customer_id?: string
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_users: {
        Row: {
          auth_user_id: string | null
          created_at: string
          email: string
          id: string
          name: string
          role: string
          status: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          email: string
          id?: string
          name: string
          role?: string
          status?: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string
          role?: string
          status?: string
        }
        Relationships: []
      }
      afa_registrations: {
        Row: {
          admin_note: string
          affiliate_code: string
          buyer_email: string
          buyer_phone: string
          buyer_type: string
          created_at: string
          customer_id: string | null
          full_name: string
          id: string
          location: string
          payment_method: string
          payment_reference: string
          payment_verified_at: string | null
          processed_at: string | null
          processed_by: string | null
          registration_phone: string
          short_id: string
          status: string
          total_amount: number
          tracking_token: string | null
          updated_at: string
        }
        Insert: {
          admin_note?: string
          affiliate_code?: string
          buyer_email?: string
          buyer_phone?: string
          buyer_type?: string
          created_at?: string
          customer_id?: string | null
          full_name: string
          id?: string
          location: string
          payment_method?: string
          payment_reference?: string
          payment_verified_at?: string | null
          processed_at?: string | null
          processed_by?: string | null
          registration_phone: string
          short_id?: string
          status?: string
          total_amount?: number
          tracking_token?: string | null
          updated_at?: string
        }
        Update: {
          admin_note?: string
          affiliate_code?: string
          buyer_email?: string
          buyer_phone?: string
          buyer_type?: string
          created_at?: string
          customer_id?: string | null
          full_name?: string
          id?: string
          location?: string
          payment_method?: string
          payment_reference?: string
          payment_verified_at?: string | null
          processed_at?: string | null
          processed_by?: string | null
          registration_phone?: string
          short_id?: string
          status?: string
          total_amount?: number
          tracking_token?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      affiliate_withdrawals: {
        Row: {
          admin_note: string | null
          amount: number
          created_at: string
          customer_id: string
          id: string
          momo_name: string
          momo_number: string
          processed_at: string | null
          processed_by: string | null
          status: string
        }
        Insert: {
          admin_note?: string | null
          amount?: number
          created_at?: string
          customer_id: string
          id?: string
          momo_name?: string
          momo_number?: string
          processed_at?: string | null
          processed_by?: string | null
          status?: string
        }
        Update: {
          admin_note?: string | null
          amount?: number
          created_at?: string
          customer_id?: string
          id?: string
          momo_name?: string
          momo_number?: string
          processed_at?: string | null
          processed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_withdrawals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      api_invalid_key_counters: {
        Row: {
          bucket_start: string
          count: number
          endpoint: string
        }
        Insert: {
          bucket_start: string
          count?: number
          endpoint: string
        }
        Update: {
          bucket_start?: string
          count?: number
          endpoint?: string
        }
        Relationships: []
      }
      api_monitor_failures: {
        Row: {
          bucket_start: string
          count: number
          kind: string
        }
        Insert: {
          bucket_start: string
          count?: number
          kind: string
        }
        Update: {
          bucket_start?: string
          count?: number
          kind?: string
        }
        Relationships: []
      }
      api_monitor_settings: {
        Row: {
          counting_started_at: string | null
          limits: Json
          mode: string
          shadow_started_at: string | null
          singleton: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          counting_started_at?: string | null
          limits: Json
          mode?: string
          shadow_started_at?: string | null
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          counting_started_at?: string | null
          limits?: Json
          mode?: string
          shadow_started_at?: string | null
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_monitor_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      api_rate_windows: {
        Row: {
          count: number
          req_class: string
          scope: string
          subject_id: string
          win: string
          window_start: string
        }
        Insert: {
          count?: number
          req_class: string
          scope: string
          subject_id: string
          win: string
          window_start: string
        }
        Update: {
          count?: number
          req_class?: string
          scope?: string
          subject_id?: string
          win?: string
          window_start?: string
        }
        Relationships: []
      }
      api_request_counters: {
        Row: {
          api_key_id: string | null
          bucket_start: string
          count: number
          customer_id: string | null
          endpoint: string
          outcome: string
          would_block_count: number
        }
        Insert: {
          api_key_id?: string | null
          bucket_start: string
          count?: number
          customer_id?: string | null
          endpoint: string
          outcome: string
          would_block_count?: number
        }
        Update: {
          api_key_id?: string | null
          bucket_start?: string
          count?: number
          customer_id?: string | null
          endpoint?: string
          outcome?: string
          would_block_count?: number
        }
        Relationships: []
      }
      api_shadow_blocks: {
        Row: {
          api_key_id: string | null
          bucket_start: string
          count: number
          customer_id: string | null
          rule: string
        }
        Insert: {
          api_key_id?: string | null
          bucket_start: string
          count?: number
          customer_id?: string | null
          rule: string
        }
        Update: {
          api_key_id?: string | null
          bucket_start?: string
          count?: number
          customer_id?: string | null
          rule?: string
        }
        Relationships: []
      }
      authorized_cross_network_users: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          enabled: boolean
          expires_at: string | null
          id: string
          notes: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          enabled?: boolean
          expires_at?: string | null
          id?: string
          notes?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          enabled?: boolean
          expires_at?: string | null
          id?: string
          notes?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "authorized_cross_network_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      blind_sweep_runs: {
        Row: {
          already_local: number
          dry_run: boolean
          duration_ms: number | null
          error_message: string | null
          errors: number
          flagged_needs_review: number
          hours_back: number
          id: string
          ran_at: string
          recovered_topup: number
          scanned: number
          skipped_unsafe: number
          succeeded: boolean
          triggered_by: string
        }
        Insert: {
          already_local?: number
          dry_run?: boolean
          duration_ms?: number | null
          error_message?: string | null
          errors?: number
          flagged_needs_review?: number
          hours_back?: number
          id?: string
          ran_at?: string
          recovered_topup?: number
          scanned?: number
          skipped_unsafe?: number
          succeeded?: boolean
          triggered_by?: string
        }
        Update: {
          already_local?: number
          dry_run?: boolean
          duration_ms?: number | null
          error_message?: string | null
          errors?: number
          flagged_needs_review?: number
          hours_back?: number
          id?: string
          ran_at?: string
          recovered_topup?: number
          scanned?: number
          skipped_unsafe?: number
          succeeded?: boolean
          triggered_by?: string
        }
        Relationships: []
      }
      checker_inventory: {
        Row: {
          assigned_to: string | null
          batch_id: string
          id: string
          imported_at: string
          pin: string
          product_id: string
          purchase_id: string | null
          serial_number: string
          sold_at: string | null
          status: string
        }
        Insert: {
          assigned_to?: string | null
          batch_id?: string
          id?: string
          imported_at?: string
          pin: string
          product_id: string
          purchase_id?: string | null
          serial_number: string
          sold_at?: string | null
          status?: string
        }
        Update: {
          assigned_to?: string | null
          batch_id?: string
          id?: string
          imported_at?: string
          pin?: string
          product_id?: string
          purchase_id?: string | null
          serial_number?: string
          sold_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "checker_inventory_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checker_inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "checker_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checker_inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "checker_products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checker_inventory_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "checker_purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      checker_products: {
        Row: {
          cost_price: number
          created_at: string
          exam_type: Database["public"]["Enums"]["exam_type"]
          id: string
          name: string
          price: number
          status: string
          updated_at: string
        }
        Insert: {
          cost_price?: number
          created_at?: string
          exam_type: Database["public"]["Enums"]["exam_type"]
          id?: string
          name: string
          price?: number
          status?: string
          updated_at?: string
        }
        Update: {
          cost_price?: number
          created_at?: string
          exam_type?: Database["public"]["Enums"]["exam_type"]
          id?: string
          name?: string
          price?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      checker_purchases: {
        Row: {
          affiliate_code: string
          amount: number
          buyer_email: string
          buyer_phone: string
          buyer_type: string
          checker_inventory_id: string | null
          created_at: string
          customer_id: string | null
          id: string
          payment_method: string
          payment_reference: string
          payment_verified_at: string | null
          product_id: string
          quantity: number
          short_id: string
          sms_phone: string
          sms_status: string
          status: string
          tracking_token: string | null
        }
        Insert: {
          affiliate_code?: string
          amount?: number
          buyer_email?: string
          buyer_phone?: string
          buyer_type?: string
          checker_inventory_id?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          payment_method?: string
          payment_reference?: string
          payment_verified_at?: string | null
          product_id: string
          quantity?: number
          short_id?: string
          sms_phone?: string
          sms_status?: string
          status?: string
          tracking_token?: string | null
        }
        Update: {
          affiliate_code?: string
          amount?: number
          buyer_email?: string
          buyer_phone?: string
          buyer_type?: string
          checker_inventory_id?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          payment_method?: string
          payment_reference?: string
          payment_verified_at?: string | null
          product_id?: string
          quantity?: number
          short_id?: string
          sms_phone?: string
          sms_status?: string
          status?: string
          tracking_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checker_purchases_checker_inventory_id_fkey"
            columns: ["checker_inventory_id"]
            isOneToOne: false
            referencedRelation: "checker_inventory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checker_purchases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checker_purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "checker_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checker_purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "checker_products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      cross_network_bypass_audit: {
        Row: {
          created_at: string
          customer_email: string | null
          customer_id: string | null
          detected_network: string | null
          email: string | null
          flow: string | null
          id: string
          order_id: string | null
          order_short_id: string | null
          reason: string
          recipient_phone: string
          selected_network: string
        }
        Insert: {
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          detected_network?: string | null
          email?: string | null
          flow?: string | null
          id?: string
          order_id?: string | null
          order_short_id?: string | null
          reason?: string
          recipient_phone: string
          selected_network: string
        }
        Update: {
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          detected_network?: string | null
          email?: string | null
          flow?: string | null
          id?: string
          order_id?: string | null
          order_short_id?: string | null
          reason?: string
          recipient_phone?: string
          selected_network?: string
        }
        Relationships: []
      }
      customer_api_keys: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          is_active: boolean
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          is_active?: boolean
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          is_active?: boolean
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_api_keys_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_tags: {
        Row: {
          created_at: string
          created_by: string
          customer_id: string
          id: string
          tag: string
        }
        Insert: {
          created_at?: string
          created_by: string
          customer_id: string
          id?: string
          tag: string
        }
        Update: {
          created_at?: string
          created_by?: string
          customer_id?: string
          id?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_tags_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          affiliate_code: string
          anonymized_at: string | null
          auth_user_id: string | null
          available_commission: number
          created_at: string
          deleted_at: string | null
          email: string
          email_verified: boolean
          full_name: string
          id: string
          locked_commission: number
          notification_preferences: Json
          phone: string
          referred_by: string | null
          status: string
          total_commission: number
          transaction_pin_hash: string | null
          username: string | null
          wallet_balance: number
        }
        Insert: {
          affiliate_code?: string
          anonymized_at?: string | null
          auth_user_id?: string | null
          available_commission?: number
          created_at?: string
          deleted_at?: string | null
          email: string
          email_verified?: boolean
          full_name: string
          id?: string
          locked_commission?: number
          notification_preferences?: Json
          phone?: string
          referred_by?: string | null
          status?: string
          total_commission?: number
          transaction_pin_hash?: string | null
          username?: string | null
          wallet_balance?: number
        }
        Update: {
          affiliate_code?: string
          anonymized_at?: string | null
          auth_user_id?: string | null
          available_commission?: number
          created_at?: string
          deleted_at?: string | null
          email?: string
          email_verified?: boolean
          full_name?: string
          id?: string
          locked_commission?: number
          notification_preferences?: Json
          phone?: string
          referred_by?: string | null
          status?: string
          total_commission?: number
          transaction_pin_hash?: string | null
          username?: string | null
          wallet_balance?: number
        }
        Relationships: []
      }
      developer_api_purchases: {
        Row: {
          amount_charged: number | null
          client_reference: string | null
          created_at: string
          customer_id: string
          id: string
          idempotency_key_hash: string
          order_id: string | null
          request_fingerprint: string
          short_id: string | null
        }
        Insert: {
          amount_charged?: number | null
          client_reference?: string | null
          created_at?: string
          customer_id: string
          id?: string
          idempotency_key_hash: string
          order_id?: string | null
          request_fingerprint: string
          short_id?: string | null
        }
        Update: {
          amount_charged?: number | null
          client_reference?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          idempotency_key_hash?: string
          order_id?: string | null
          request_fingerprint?: string
          short_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "developer_api_purchases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "developer_api_purchases_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "developer_api_purchases_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_admin"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_events: {
        Row: {
          aggregate_id: string | null
          aggregate_type: string
          event_key: string
          event_type: string
          id: string
          occurred_at: string
          owner_id: string | null
          payload: Json
          processed_at: string | null
        }
        Insert: {
          aggregate_id?: string | null
          aggregate_type: string
          event_key: string
          event_type: string
          id?: string
          occurred_at?: string
          owner_id?: string | null
          payload?: Json
          processed_at?: string | null
        }
        Update: {
          aggregate_id?: string | null
          aggregate_type?: string
          event_key?: string
          event_type?: string
          id?: string
          occurred_at?: string
          owner_id?: string | null
          payload?: Json
          processed_at?: string | null
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      login_attempts: {
        Row: {
          created_at: string
          email: string
          id: string
          ip_address: string | null
          success: boolean
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          ip_address?: string | null
          success?: boolean
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          ip_address?: string | null
          success?: boolean
        }
        Relationships: []
      }
      mtn_number_verifications: {
        Row: {
          checked_at: string
          message: string
          phone: string
          status: string
          verified_at: string | null
        }
        Insert: {
          checked_at?: string
          message?: string
          phone: string
          status: string
          verified_at?: string | null
        }
        Update: {
          checked_at?: string
          message?: string
          phone?: string
          status?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      mtn_provider_settings: {
        Row: {
          active_provider: string
          iget_api_enabled: boolean
          iget_bundle_type: string
          portal02_api_enabled: boolean
          singleton: boolean
          switched_at: string | null
          switched_by: string | null
        }
        Insert: {
          active_provider?: string
          iget_api_enabled?: boolean
          iget_bundle_type?: string
          portal02_api_enabled?: boolean
          singleton?: boolean
          switched_at?: string | null
          switched_by?: string | null
        }
        Update: {
          active_provider?: string
          iget_api_enabled?: boolean
          iget_bundle_type?: string
          portal02_api_enabled?: boolean
          singleton?: boolean
          switched_at?: string | null
          switched_by?: string | null
        }
        Relationships: []
      }
      network_api_configs: {
        Row: {
          api_base_url: string
          api_key: string
          api_secret: string
          available_for_purchase: boolean
          created_at: string
          enabled: boolean
          extra_params: Json
          id: string
          network: string
          updated_at: string
        }
        Insert: {
          api_base_url?: string
          api_key?: string
          api_secret?: string
          available_for_purchase?: boolean
          created_at?: string
          enabled?: boolean
          extra_params?: Json
          id?: string
          network: string
          updated_at?: string
        }
        Update: {
          api_base_url?: string
          api_key?: string
          api_secret?: string
          available_for_purchase?: boolean
          created_at?: string
          enabled?: boolean
          extra_params?: Json
          id?: string
          network?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string
          metadata: Json | null
          read: boolean
          target_id: string | null
          target_type: string
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string
          metadata?: Json | null
          read?: boolean
          target_id?: string | null
          target_type?: string
          title: string
          type?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          metadata?: Json | null
          read?: boolean
          target_id?: string | null
          target_type?: string
          title?: string
          type?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          affiliate_code: string
          bundle_size: string
          buyer_email: string
          buyer_phone: string
          buyer_type: string
          cost_price: number
          created_at: string
          customer_id: string | null
          delivery_mode: string
          detected_network: string | null
          grace_period_ends_at: string | null
          id: string
          linked_customer_id: string | null
          network: string
          payment_method: string
          payment_reference: string
          payment_verified_at: string | null
          provider_bundle_type: string | null
          provider_completed_at: string | null
          provider_name: string
          provider_order_id: string
          provider_purchase_cost: number | null
          provider_reference: string
          provider_response: Json | null
          provider_routing_version: number
          provider_submission_reference: string | null
          provider_submission_started_at: string | null
          provider_submission_uncertain: boolean
          provider_transaction_reference: string | null
          quantity: number
          recipient_phone: string
          refund_momo_number: string
          short_id: string
          status: string
          total_amount: number
          tracking_token: string | null
          webhook_history: Json | null
        }
        Insert: {
          affiliate_code?: string
          bundle_size?: string
          buyer_email?: string
          buyer_phone?: string
          buyer_type?: string
          cost_price?: number
          created_at?: string
          customer_id?: string | null
          delivery_mode?: string
          detected_network?: string | null
          grace_period_ends_at?: string | null
          id?: string
          linked_customer_id?: string | null
          network: string
          payment_method?: string
          payment_reference?: string
          payment_verified_at?: string | null
          provider_bundle_type?: string | null
          provider_completed_at?: string | null
          provider_name?: string
          provider_order_id?: string
          provider_purchase_cost?: number | null
          provider_reference?: string
          provider_response?: Json | null
          provider_routing_version?: number
          provider_submission_reference?: string | null
          provider_submission_started_at?: string | null
          provider_submission_uncertain?: boolean
          provider_transaction_reference?: string | null
          quantity?: number
          recipient_phone?: string
          refund_momo_number?: string
          short_id?: string
          status?: string
          total_amount?: number
          tracking_token?: string | null
          webhook_history?: Json | null
        }
        Update: {
          affiliate_code?: string
          bundle_size?: string
          buyer_email?: string
          buyer_phone?: string
          buyer_type?: string
          cost_price?: number
          created_at?: string
          customer_id?: string | null
          delivery_mode?: string
          detected_network?: string | null
          grace_period_ends_at?: string | null
          id?: string
          linked_customer_id?: string | null
          network?: string
          payment_method?: string
          payment_reference?: string
          payment_verified_at?: string | null
          provider_bundle_type?: string | null
          provider_completed_at?: string | null
          provider_name?: string
          provider_order_id?: string
          provider_purchase_cost?: number | null
          provider_reference?: string
          provider_response?: Json | null
          provider_routing_version?: number
          provider_submission_reference?: string | null
          provider_submission_started_at?: string | null
          provider_submission_uncertain?: boolean
          provider_transaction_reference?: string | null
          quantity?: number
          recipient_phone?: string
          refund_momo_number?: string
          short_id?: string
          status?: string
          total_amount?: number
          tracking_token?: string | null
          webhook_history?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      otp_codes: {
        Row: {
          code: string
          created_at: string
          email: string
          expires_at: string
          id: string
          purpose: string
          used: boolean
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          email: string
          expires_at: string
          id?: string
          purpose?: string
          used?: boolean
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          purpose?: string
          used?: boolean
          user_id?: string
        }
        Relationships: []
      }
      payment_attempts: {
        Row: {
          affiliate_code: string
          amount: number
          attempt_type: string
          buyer_email: string
          buyer_phone: string
          buyer_type: string
          callback_received_at: string | null
          created_at: string
          currency: string
          customer_id: string
          error_message: string | null
          event_log: Json
          finalized_at: string | null
          finalized_by: string | null
          id: string
          items_succeeded: number | null
          items_total: number | null
          last_recovery_at: string | null
          last_verified_at: string | null
          metadata: Json
          order_id: string | null
          paystack_reference: string
          paystack_response: Json | null
          paystack_transaction_id: string | null
          purchase_id: string | null
          recovery_attempts: number
          status: string
          updated_at: string
          webhook_received_at: string | null
        }
        Insert: {
          affiliate_code?: string
          amount?: number
          attempt_type?: string
          buyer_email?: string
          buyer_phone?: string
          buyer_type?: string
          callback_received_at?: string | null
          created_at?: string
          currency?: string
          customer_id: string
          error_message?: string | null
          event_log?: Json
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          items_succeeded?: number | null
          items_total?: number | null
          last_recovery_at?: string | null
          last_verified_at?: string | null
          metadata?: Json
          order_id?: string | null
          paystack_reference: string
          paystack_response?: Json | null
          paystack_transaction_id?: string | null
          purchase_id?: string | null
          recovery_attempts?: number
          status?: string
          updated_at?: string
          webhook_received_at?: string | null
        }
        Update: {
          affiliate_code?: string
          amount?: number
          attempt_type?: string
          buyer_email?: string
          buyer_phone?: string
          buyer_type?: string
          callback_received_at?: string | null
          created_at?: string
          currency?: string
          customer_id?: string
          error_message?: string | null
          event_log?: Json
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          items_succeeded?: number | null
          items_total?: number | null
          last_recovery_at?: string | null
          last_verified_at?: string | null
          metadata?: Json
          order_id?: string | null
          paystack_reference?: string
          paystack_response?: Json | null
          paystack_transaction_id?: string | null
          purchase_id?: string | null
          recovery_attempts?: number
          status?: string
          updated_at?: string
          webhook_received_at?: string | null
        }
        Relationships: []
      }
      payout_audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          created_at: string
          details: Json
          id: string
          new_status: string | null
          payout_id: string
          prev_status: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          details?: Json
          id?: string
          new_status?: string | null
          payout_id: string
          prev_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          details?: Json
          id?: string
          new_status?: string | null
          payout_id?: string
          prev_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payout_audit_logs_payout_id_fkey"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "payouts"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          account_number: string
          admin_note: string
          amount: number
          approved_at: string | null
          approved_by: string | null
          bank_code: string
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          failure_reason: string | null
          fee: number
          id: string
          idempotency_key: string
          momo_name: string
          momo_number: string
          net_amount: number
          network: string
          owner_id: string
          payout_type: string
          paystack_recipient_code: string | null
          paystack_response: Json | null
          paystack_transfer_code: string | null
          paystack_transfer_reference: string | null
          processed_at: string | null
          rail: string
          recipient_type: string
          requested_by: string | null
          short_id: string
          status: string
          updated_at: string
        }
        Insert: {
          account_number?: string
          admin_note?: string
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          bank_code?: string
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          fee?: number
          id?: string
          idempotency_key: string
          momo_name?: string
          momo_number?: string
          net_amount: number
          network?: string
          owner_id: string
          payout_type: string
          paystack_recipient_code?: string | null
          paystack_response?: Json | null
          paystack_transfer_code?: string | null
          paystack_transfer_reference?: string | null
          processed_at?: string | null
          rail?: string
          recipient_type?: string
          requested_by?: string | null
          short_id?: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_number?: string
          admin_note?: string
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          bank_code?: string
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          fee?: number
          id?: string
          idempotency_key?: string
          momo_name?: string
          momo_number?: string
          net_amount?: number
          network?: string
          owner_id?: string
          payout_type?: string
          paystack_recipient_code?: string | null
          paystack_response?: Json | null
          paystack_transfer_code?: string | null
          paystack_transfer_reference?: string | null
          processed_at?: string | null
          rail?: string
          recipient_type?: string
          requested_by?: string | null
          short_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payouts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      paystack_recipients: {
        Row: {
          account_name: string
          account_number: string
          active: boolean
          bank_code: string
          created_at: string
          customer_id: string
          id: string
          last_used_at: string | null
          network: string
          paystack_response: Json | null
          recipient_code: string
          recipient_type: string
        }
        Insert: {
          account_name?: string
          account_number: string
          active?: boolean
          bank_code?: string
          created_at?: string
          customer_id: string
          id?: string
          last_used_at?: string | null
          network?: string
          paystack_response?: Json | null
          recipient_code: string
          recipient_type?: string
        }
        Update: {
          account_name?: string
          account_number?: string
          active?: boolean
          bank_code?: string
          created_at?: string
          customer_id?: string
          id?: string
          last_used_at?: string | null
          network?: string
          paystack_response?: Json | null
          recipient_code?: string
          recipient_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "paystack_recipients_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          value?: string
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      price_items: {
        Row: {
          cost_price: number
          created_at: string
          id: string
          network: string
          price: number
          product: string
          size: string
          updated_at: string
        }
        Insert: {
          cost_price?: number
          created_at?: string
          id?: string
          network: string
          price?: number
          product: string
          size?: string
          updated_at?: string
        }
        Update: {
          cost_price?: number
          created_at?: string
          id?: string
          network?: string
          price?: number
          product?: string
          size?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string
        }
        Insert: {
          created_at?: string
          email?: string
          full_name?: string
          id: string
          phone?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string
        }
        Relationships: []
      }
      provider_balance_current: {
        Row: {
          balance: number | null
          currency: string | null
          error_message: string | null
          last_checked_at: string
          last_success_at: string | null
          last_success_balance: number | null
          provider: string
          status: string
          supported: boolean
          updated_at: string
        }
        Insert: {
          balance?: number | null
          currency?: string | null
          error_message?: string | null
          last_checked_at?: string
          last_success_at?: string | null
          last_success_balance?: number | null
          provider: string
          status: string
          supported?: boolean
          updated_at?: string
        }
        Update: {
          balance?: number | null
          currency?: string | null
          error_message?: string | null
          last_checked_at?: string
          last_success_at?: string | null
          last_success_balance?: number | null
          provider?: string
          status?: string
          supported?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      provider_balance_history: {
        Row: {
          balance: number | null
          created_at: string
          currency: string | null
          error_message: string | null
          id: string
          provider: string
          retrieved_at: string
          status: string
        }
        Insert: {
          balance?: number | null
          created_at?: string
          currency?: string | null
          error_message?: string | null
          id?: string
          provider: string
          retrieved_at?: string
          status: string
        }
        Update: {
          balance?: number | null
          created_at?: string
          currency?: string | null
          error_message?: string | null
          id?: string
          provider?: string
          retrieved_at?: string
          status?: string
        }
        Relationships: []
      }
      provider_call_attempts: {
        Row: {
          admin_id: string | null
          blocked_reason: string | null
          confirmation_token: string | null
          created_at: string
          endpoint: string | null
          id: string
          kind: string
          outcome: string | null
          payload_summary: Json | null
          provider: string
          source: string | null
        }
        Insert: {
          admin_id?: string | null
          blocked_reason?: string | null
          confirmation_token?: string | null
          created_at?: string
          endpoint?: string | null
          id?: string
          kind: string
          outcome?: string | null
          payload_summary?: Json | null
          provider: string
          source?: string | null
        }
        Update: {
          admin_id?: string | null
          blocked_reason?: string | null
          confirmation_token?: string | null
          created_at?: string
          endpoint?: string | null
          id?: string
          kind?: string
          outcome?: string | null
          payload_summary?: Json | null
          provider?: string
          source?: string | null
        }
        Relationships: []
      }
      reconciliation_issues: {
        Row: {
          admin_note: string | null
          computed_balance: number
          confidence: string
          created_at: string
          current_balance: number
          customer_id: string | null
          diagnostic_details: Json | null
          id: string
          issue_type: string
          likely_cause: string | null
          linked_transactions: Json | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          suggested_fix: string | null
          updated_at: string
          variance: number
        }
        Insert: {
          admin_note?: string | null
          computed_balance?: number
          confidence?: string
          created_at?: string
          current_balance?: number
          customer_id?: string | null
          diagnostic_details?: Json | null
          id?: string
          issue_type?: string
          likely_cause?: string | null
          linked_transactions?: Json | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          suggested_fix?: string | null
          updated_at?: string
          variance?: number
        }
        Update: {
          admin_note?: string | null
          computed_balance?: number
          confidence?: string
          created_at?: string
          current_balance?: number
          customer_id?: string | null
          diagnostic_details?: Json | null
          id?: string
          issue_type?: string
          likely_cause?: string | null
          linked_transactions?: Json | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          suggested_fix?: string | null
          updated_at?: string
          variance?: number
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_issues_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_issues_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          admin_note: string
          afa_registration_id: string | null
          amount_paid: number
          buyer_type: string
          completed_at: string | null
          created_at: string
          customer_has_wallet: boolean
          customer_id: string | null
          data_value: number
          error_message: string | null
          id: string
          idempotency_key: string | null
          initiated_by: string | null
          is_full_override: boolean
          momo_approved_at: string | null
          momo_approved_by: string | null
          momo_number: string
          order_id: string | null
          original_payment_method: string
          original_payment_reference: string
          payment_attempt_id: string | null
          paystack_reference: string | null
          paystack_refund_id: string | null
          paystack_response: Json | null
          paystack_transaction_id: string | null
          processed_at: string | null
          provider_name: string
          provider_reference: string
          refund_amount: number
          refund_destination: string
          refund_method: string
          refund_reason: string | null
          status: string
          timeline: Json
          total_refunded: number
          updated_at: string
        }
        Insert: {
          admin_note?: string
          afa_registration_id?: string | null
          amount_paid?: number
          buyer_type?: string
          completed_at?: string | null
          created_at?: string
          customer_has_wallet?: boolean
          customer_id?: string | null
          data_value?: number
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          initiated_by?: string | null
          is_full_override?: boolean
          momo_approved_at?: string | null
          momo_approved_by?: string | null
          momo_number?: string
          order_id?: string | null
          original_payment_method?: string
          original_payment_reference?: string
          payment_attempt_id?: string | null
          paystack_reference?: string | null
          paystack_refund_id?: string | null
          paystack_response?: Json | null
          paystack_transaction_id?: string | null
          processed_at?: string | null
          provider_name?: string
          provider_reference?: string
          refund_amount?: number
          refund_destination?: string
          refund_method?: string
          refund_reason?: string | null
          status?: string
          timeline?: Json
          total_refunded?: number
          updated_at?: string
        }
        Update: {
          admin_note?: string
          afa_registration_id?: string | null
          amount_paid?: number
          buyer_type?: string
          completed_at?: string | null
          created_at?: string
          customer_has_wallet?: boolean
          customer_id?: string | null
          data_value?: number
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          initiated_by?: string | null
          is_full_override?: boolean
          momo_approved_at?: string | null
          momo_approved_by?: string | null
          momo_number?: string
          order_id?: string | null
          original_payment_method?: string
          original_payment_reference?: string
          payment_attempt_id?: string | null
          paystack_reference?: string | null
          paystack_refund_id?: string | null
          paystack_response?: Json | null
          paystack_transaction_id?: string | null
          processed_at?: string | null
          provider_name?: string
          provider_reference?: string
          refund_amount?: number
          refund_destination?: string
          refund_method?: string
          refund_reason?: string | null
          status?: string
          timeline?: Json
          total_refunded?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "payment_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      security_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          device: string | null
          id: string
          ip_address: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          device?: string | null
          id?: string
          ip_address?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          device?: string | null
          id?: string
          ip_address?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      sms_send_log: {
        Row: {
          created_at: string
          customer_id: string | null
          error_message: string | null
          event_type: string
          id: string
          message_body: string
          provider_response: Json | null
          recipient_phone: string
          related_order_id: string | null
          related_purchase_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          error_message?: string | null
          event_type?: string
          id?: string
          message_body?: string
          provider_response?: Json | null
          recipient_phone?: string
          related_order_id?: string | null
          related_purchase_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          error_message?: string | null
          event_type?: string
          id?: string
          message_body?: string
          provider_response?: Json | null
          recipient_phone?: string
          related_order_id?: string | null
          related_purchase_id?: string | null
          status?: string
        }
        Relationships: []
      }
      store_checkout_initiations: {
        Row: {
          amount: number
          created_at: string
          id: string
          kind: string
          session_hash: string
          store_id: string
          store_product_id: string | null
          traffic_source: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          kind: string
          session_hash: string
          store_id: string
          store_product_id?: string | null
          traffic_source?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          kind?: string
          session_hash?: string
          store_id?: string
          store_product_id?: string | null
          traffic_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_checkout_initiations_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_checkout_initiations_store_product_id_fkey"
            columns: ["store_product_id"]
            isOneToOne: false
            referencedRelation: "store_products"
            referencedColumns: ["id"]
          },
        ]
      }
      store_orders: {
        Row: {
          afa_registration_id: string | null
          amount_paid: number
          buyer_phone: string
          checker_product_id: string | null
          checker_purchase_id: string | null
          created_at: string
          id: string
          kind: string
          order_id: string | null
          price_item_id: string | null
          profit: number
          status: string
          store_id: string
          store_owner_id: string
          updated_at: string
        }
        Insert: {
          afa_registration_id?: string | null
          amount_paid: number
          buyer_phone?: string
          checker_product_id?: string | null
          checker_purchase_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          order_id?: string | null
          price_item_id?: string | null
          profit?: number
          status?: string
          store_id: string
          store_owner_id: string
          updated_at?: string
        }
        Update: {
          afa_registration_id?: string | null
          amount_paid?: number
          buyer_phone?: string
          checker_product_id?: string | null
          checker_purchase_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          order_id?: string | null
          price_item_id?: string | null
          profit?: number
          status?: string
          store_id?: string
          store_owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_orders_afa_registration_id_fkey"
            columns: ["afa_registration_id"]
            isOneToOne: false
            referencedRelation: "afa_registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_orders_checker_product_id_fkey"
            columns: ["checker_product_id"]
            isOneToOne: false
            referencedRelation: "checker_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_orders_checker_product_id_fkey"
            columns: ["checker_product_id"]
            isOneToOne: false
            referencedRelation: "checker_products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_orders_checker_purchase_id_fkey"
            columns: ["checker_purchase_id"]
            isOneToOne: false
            referencedRelation: "checker_purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_orders_price_item_id_fkey"
            columns: ["price_item_id"]
            isOneToOne: false
            referencedRelation: "price_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_orders_price_item_id_fkey"
            columns: ["price_item_id"]
            isOneToOne: false
            referencedRelation: "public_price_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_orders_store_owner_id_fkey"
            columns: ["store_owner_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      store_product_clicks: {
        Row: {
          created_at: string
          id: string
          session_hash: string
          store_id: string
          store_product_id: string
          traffic_source: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          session_hash?: string
          store_id: string
          store_product_id: string
          traffic_source?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          session_hash?: string
          store_id?: string
          store_product_id?: string
          traffic_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_product_clicks_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_product_clicks_store_product_id_fkey"
            columns: ["store_product_id"]
            isOneToOne: false
            referencedRelation: "store_products"
            referencedColumns: ["id"]
          },
        ]
      }
      store_products: {
        Row: {
          active: boolean
          checker_product_id: string | null
          created_at: string
          id: string
          kind: string
          price_item_id: string | null
          selling_price: number
          store_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          checker_product_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          price_item_id?: string | null
          selling_price: number
          store_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          checker_product_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          price_item_id?: string | null
          selling_price?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_products_checker_product_id_fkey"
            columns: ["checker_product_id"]
            isOneToOne: false
            referencedRelation: "checker_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_products_checker_product_id_fkey"
            columns: ["checker_product_id"]
            isOneToOne: false
            referencedRelation: "checker_products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_products_price_item_id_fkey"
            columns: ["price_item_id"]
            isOneToOne: false
            referencedRelation: "price_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_products_price_item_id_fkey"
            columns: ["price_item_id"]
            isOneToOne: false
            referencedRelation: "public_price_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_visits: {
        Row: {
          created_at: string
          id: string
          is_returning: boolean
          landed_at: string
          path: string
          referrer: string | null
          session_duration_seconds: number | null
          session_hash: string
          store_id: string
          traffic_source: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_returning?: boolean
          landed_at?: string
          path?: string
          referrer?: string | null
          session_duration_seconds?: number | null
          session_hash?: string
          store_id: string
          traffic_source?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_returning?: boolean
          landed_at?: string
          path?: string
          referrer?: string | null
          session_duration_seconds?: number | null
          session_hash?: string
          store_id?: string
          traffic_source?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_visits_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_wallets: {
        Row: {
          available_balance: number
          locked_balance: number
          owner_id: string
          pending_balance: number
          updated_at: string
          withdrawn_balance: number
        }
        Insert: {
          available_balance?: number
          locked_balance?: number
          owner_id: string
          pending_balance?: number
          updated_at?: string
          withdrawn_balance?: number
        }
        Update: {
          available_balance?: number
          locked_balance?: number
          owner_id?: string
          pending_balance?: number
          updated_at?: string
          withdrawn_balance?: number
        }
        Relationships: [
          {
            foreignKeyName: "store_wallets_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      store_withdrawals: {
        Row: {
          admin_notes: string | null
          amount: number
          created_at: string
          id: string
          momo_name: string
          momo_number: string
          owner_id: string
          paystack_reference: string | null
          status: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          amount: number
          created_at?: string
          id?: string
          momo_name: string
          momo_number: string
          owner_id: string
          paystack_reference?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          amount?: number
          created_at?: string
          id?: string
          momo_name?: string
          momo_number?: string
          owner_id?: string
          paystack_reference?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_withdrawals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          afa_enabled: boolean
          afa_price: number
          banner_url: string | null
          contact_email: string | null
          contact_group_link: string | null
          contact_whatsapp: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          logo_url: string | null
          name: string
          onboarding_completed: boolean
          onboarding_started_at: string | null
          onboarding_step: number
          owner_id: string
          rejected_at: string | null
          rejection_reason: string | null
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          afa_enabled?: boolean
          afa_price?: number
          banner_url?: string | null
          contact_email?: string | null
          contact_group_link?: string | null
          contact_whatsapp?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          logo_url?: string | null
          name: string
          onboarding_completed?: boolean
          onboarding_started_at?: string | null
          onboarding_step?: number
          owner_id: string
          rejected_at?: string | null
          rejection_reason?: string | null
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          afa_enabled?: boolean
          afa_price?: number
          banner_url?: string | null
          contact_email?: string | null
          contact_group_link?: string | null
          contact_whatsapp?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          onboarding_completed?: boolean
          onboarding_started_at?: string | null
          onboarding_step?: number
          owner_id?: string
          rejected_at?: string | null
          rejection_reason?: string | null
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      super_agent_price_overrides: {
        Row: {
          price: number
          price_item_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          price: number
          price_item_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          price?: number
          price_item_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "super_agent_price_overrides_price_item_id_fkey"
            columns: ["price_item_id"]
            isOneToOne: true
            referencedRelation: "price_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "super_agent_price_overrides_price_item_id_fkey"
            columns: ["price_item_id"]
            isOneToOne: true
            referencedRelation: "public_price_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "super_agent_price_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      super_agent_settings: {
        Row: {
          default_discount_pct: number
          singleton: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          default_discount_pct?: number
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          default_discount_pct?: number
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "super_agent_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      super_agents: {
        Row: {
          created_at: string
          customer_id: string
          granted_at: string
          granted_by: string | null
          status: string
          status_changed_at: string
          status_changed_by: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          granted_at?: string
          granted_by?: string | null
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          granted_at?: string
          granted_by?: string | null
          status?: string
          status_changed_at?: string
          status_changed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "super_agents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "super_agents_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "super_agents_status_changed_by_fkey"
            columns: ["status_changed_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          attachment_url: string | null
          created_at: string
          id: string
          message: string
          sender_id: string
          sender_role: string
          ticket_id: string
        }
        Insert: {
          attachment_url?: string | null
          created_at?: string
          id?: string
          message?: string
          sender_id: string
          sender_role?: string
          ticket_id: string
        }
        Update: {
          attachment_url?: string | null
          created_at?: string
          id?: string
          message?: string
          sender_id?: string
          sender_role?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          category: string
          created_at: string
          customer_id: string
          id: string
          message: string
          priority: string
          related_order_id: string | null
          related_wallet_transaction_id: string | null
          short_id: string
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          customer_id: string
          id?: string
          message?: string
          priority?: string
          related_order_id?: string | null
          related_wallet_transaction_id?: string | null
          short_id?: string
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          customer_id?: string
          id?: string
          message?: string
          priority?: string
          related_order_id?: string | null
          related_wallet_transaction_id?: string | null
          short_id?: string
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "orders_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_related_wallet_transaction_id_fkey"
            columns: ["related_wallet_transaction_id"]
            isOneToOne: false
            referencedRelation: "wallet_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      topups: {
        Row: {
          amount: number
          created_at: string
          customer_id: string | null
          id: string
          method: string
          momo_number: string
          network: string
          payment_reference: string
          short_id: string
          status: string
        }
        Insert: {
          amount?: number
          created_at?: string
          customer_id?: string | null
          id?: string
          method?: string
          momo_number?: string
          network?: string
          payment_reference?: string
          short_id?: string
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          customer_id?: string | null
          id?: string
          method?: string
          momo_number?: string
          network?: string
          payment_reference?: string
          short_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "topups_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          admin_id: string | null
          amount: number
          balance_after: number | null
          balance_before: number | null
          created_at: string
          customer_id: string
          description: string
          id: string
          reference: string
          type: string
        }
        Insert: {
          admin_id?: string | null
          amount?: number
          balance_after?: number | null
          balance_before?: number | null
          created_at?: string
          customer_id: string
          description?: string
          id?: string
          reference?: string
          type?: string
        }
        Update: {
          admin_id?: string | null
          amount?: number
          balance_after?: number | null
          balance_before?: number | null
          created_at?: string
          customer_id?: string
          description?: string
          id?: string
          reference?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      available_networks: {
        Row: {
          available_for_purchase: boolean | null
          network: string | null
        }
        Insert: {
          available_for_purchase?: boolean | null
          network?: string | null
        }
        Update: {
          available_for_purchase?: boolean | null
          network?: string | null
        }
        Relationships: []
      }
      checker_products_public: {
        Row: {
          created_at: string | null
          exam_type: Database["public"]["Enums"]["exam_type"] | null
          id: string | null
          name: string | null
          price: number | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          exam_type?: Database["public"]["Enums"]["exam_type"] | null
          id?: string | null
          name?: string | null
          price?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          exam_type?: Database["public"]["Enums"]["exam_type"] | null
          id?: string | null
          name?: string | null
          price?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      orders_admin: {
        Row: {
          affiliate_code: string | null
          bundle_size: string | null
          buyer_email: string | null
          buyer_phone: string | null
          buyer_type: string | null
          cost_price: number | null
          created_at: string | null
          customer_id: string | null
          delivery_mode: string | null
          grace_period_ends_at: string | null
          id: string | null
          linked_customer_id: string | null
          network: string | null
          payment_method: string | null
          payment_reference: string | null
          payment_verified_at: string | null
          provider_name: string | null
          provider_order_id: string | null
          provider_reference: string | null
          provider_response: Json | null
          quantity: number | null
          recipient_phone: string | null
          short_id: string | null
          status: string | null
          total_amount: number | null
          tracking_token: string | null
          webhook_history: Json | null
        }
        Insert: {
          affiliate_code?: string | null
          bundle_size?: string | null
          buyer_email?: string | null
          buyer_phone?: string | null
          buyer_type?: string | null
          cost_price?: number | null
          created_at?: string | null
          customer_id?: string | null
          delivery_mode?: string | null
          grace_period_ends_at?: string | null
          id?: string | null
          linked_customer_id?: string | null
          network?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          payment_verified_at?: string | null
          provider_name?: string | null
          provider_order_id?: string | null
          provider_reference?: string | null
          provider_response?: Json | null
          quantity?: number | null
          recipient_phone?: string | null
          short_id?: string | null
          status?: string | null
          total_amount?: number | null
          tracking_token?: string | null
          webhook_history?: Json | null
        }
        Update: {
          affiliate_code?: string | null
          bundle_size?: string | null
          buyer_email?: string | null
          buyer_phone?: string | null
          buyer_type?: string | null
          cost_price?: number | null
          created_at?: string | null
          customer_id?: string | null
          delivery_mode?: string | null
          grace_period_ends_at?: string | null
          id?: string | null
          linked_customer_id?: string | null
          network?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          payment_verified_at?: string | null
          provider_name?: string | null
          provider_order_id?: string | null
          provider_reference?: string | null
          provider_response?: Json | null
          quantity?: number | null
          recipient_phone?: string | null
          short_id?: string | null
          status?: string | null
          total_amount?: number | null
          tracking_token?: string | null
          webhook_history?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      public_price_items: {
        Row: {
          id: string | null
          network: string | null
          price: number | null
          product: string | null
          size: string | null
        }
        Insert: {
          id?: string | null
          network?: string | null
          price?: number | null
          product?: string | null
          size?: string | null
        }
        Update: {
          id?: string | null
          network?: string | null
          price?: number | null
          product?: string | null
          size?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _api_valid_endpoint: { Args: { p: string }; Returns: boolean }
      _api_valid_outcome: { Args: { p: string }; Returns: boolean }
      _has_active_order_for_recipient: {
        Args: { p_network: string; p_recipient_phone: string }
        Returns: boolean
      }
      _require_super_admin: { Args: never; Returns: string }
      _super_agent_active: { Args: { p_customer_id: string }; Returns: boolean }
      _super_agent_price: { Args: { p_price_item_id: string }; Returns: number }
      admin_api_usage_report: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      admin_approve_momo_refund: {
        Args: {
          p_admin_note?: string
          p_momo_number: string
          p_refund_id: string
        }
        Returns: Json
      }
      admin_approve_payout: {
        Args: { p_payout_id: string; p_rail?: string }
        Returns: Json
      }
      admin_cancel_payout: {
        Args: { p_payout_id: string; p_reason?: string }
        Returns: Json
      }
      admin_complete_store_withdrawal: {
        Args: { p_id: string; p_paystack_reference?: string }
        Returns: Json
      }
      admin_create_store_payout: {
        Args: {
          p_admin_note?: string
          p_amount: number
          p_idempotency_key?: string
          p_momo_name: string
          p_momo_number: string
          p_network: string
          p_owner_id: string
        }
        Returns: Json
      }
      admin_delete_store: {
        Args: { p_reason?: string; p_store_id: string }
        Returns: Json
      }
      admin_get_customer_referrals: {
        Args: { p_customer_id: string }
        Returns: {
          commission_earned: number
          email: string
          full_name: string
          id: string
          signup_date: string
          status: string
          username: string
        }[]
      }
      admin_get_mtn_provider_management: { Args: never; Returns: Json }
      admin_get_referral_leaderboard: {
        Args: never
        Returns: {
          active_referrals: number
          affiliate_code: string
          email: string
          full_name: string
          id: string
          referral_revenue: number
          signup_date: string
          status: string
          total_commission: number
          total_referrals: number
          username: string
        }[]
      }
      admin_get_super_agent_pricing: { Args: never; Returns: Json }
      admin_global_store_metrics: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      admin_list_super_agents: { Args: { p_search?: string }; Returns: Json }
      admin_mark_payout_paid_momo: {
        Args: { p_note?: string; p_payout_id: string }
        Returns: Json
      }
      admin_mtn_provider_report: {
        Args: { p_from: string; p_provider?: string; p_to: string }
        Returns: Json
      }
      admin_reject_store_withdrawal: {
        Args: { p_id: string; p_reason?: string }
        Returns: Json
      }
      admin_retry_payout: {
        Args: { p_idempotency_key: string; p_original_payout_id: string }
        Returns: Json
      }
      admin_set_api_limits: { Args: { p_limits: Json }; Returns: Json }
      admin_set_api_monitor_mode: { Args: { p_mode: string }; Returns: Json }
      admin_set_refund_status: {
        Args: { p_admin_note?: string; p_refund_id: string; p_status: string }
        Returns: Json
      }
      admin_set_store_status: {
        Args: { p_status: string; p_store_id: string }
        Returns: Json
      }
      admin_set_super_agent_default_discount: {
        Args: { p_pct: number }
        Returns: undefined
      }
      admin_set_super_agent_override: {
        Args: { p_price: number; p_price_item_id: string }
        Returns: undefined
      }
      admin_set_super_agent_status: {
        Args: { p_action: string; p_customer_id: string }
        Returns: Json
      }
      admin_store_detail: { Args: { p_store_id: string }; Returns: Json }
      admin_store_management_list: {
        Args: never
        Returns: {
          created_at: string
          failed_orders: number
          last_activity_at: string
          logo_url: string
          name: string
          owner_email: string
          owner_id: string
          owner_name: string
          owner_phone: string
          owner_username: string
          pending_orders: number
          slug: string
          status: string
          store_id: string
          successful_orders: number
          total_orders: number
          total_profit: number
          total_revenue: number
          wallet_available: number
          wallet_pending: number
          wallet_withdrawn: number
        }[]
      }
      admin_switch_mtn_provider: {
        Args: {
          p_bundle_type: string
          p_expected_provider: string
          p_provider: string
        }
        Returns: Json
      }
      admin_top_stores: {
        Args: { p_from: string; p_limit?: number; p_to: string }
        Returns: Json
      }
      api_monitor_anonymize_customer: {
        Args: { p_customer_id: string }
        Returns: undefined
      }
      api_monitor_cleanup: { Args: never; Returns: undefined }
      api_monitor_record: {
        Args: {
          p_api_key_id: string
          p_customer_id: string
          p_endpoint: string
          p_outcome: string
        }
        Returns: Json
      }
      api_monitor_record_failure: {
        Args: { p_kind: string }
        Returns: undefined
      }
      api_monitor_record_invalid: {
        Args: { p_endpoint: string }
        Returns: undefined
      }
      apply_payout_failure: {
        Args: {
          p_new_status: string
          p_payout_id: string
          p_reason: string
          p_response: Json
        }
        Returns: Json
      }
      apply_payout_success: {
        Args: { p_payout_id: string; p_response: Json }
        Returns: Json
      }
      assert_provider_call_allowed: {
        Args: {
          _confirmation_token: string
          _endpoint: string
          _kind: string
          _payload_summary?: Json
          _provider: string
        }
        Returns: Json
      }
      cancel_my_order: {
        Args: { p_customer_id: string; p_order_id: string }
        Returns: Json
      }
      check_recipient_availability: { Args: { p_items: Json }; Returns: Json }
      cleanup_provider_call_attempts: { Args: never; Returns: number }
      create_store: {
        Args: { p_description?: string; p_name: string; p_slug: string }
        Returns: Json
      }
      credit_wallet_paystack: {
        Args: {
          p_amount: number
          p_customer_id: string
          p_description: string
          p_reference: string
        }
        Returns: Json
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      detect_ghana_network: { Args: { p_phone: string }; Returns: string }
      developer_api_usage_history: {
        Args: { p_customer_id: string; p_from: string; p_to: string }
        Returns: Json
      }
      developer_api_usage_summary: {
        Args: { p_customer_id: string }
        Returns: Json
      }
      emit_event: {
        Args: {
          p_aggregate_id: string
          p_aggregate_type: string
          p_event_key: string
          p_event_type: string
          p_owner_id: string
          p_payload: Json
        }
        Returns: string
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      generate_customer_api_key: { Args: { p_name: string }; Returns: Json }
      get_email_by_username: { Args: { p_username: string }; Returns: string }
      get_my_api_request_usage: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      get_my_customer_id: { Args: never; Returns: string }
      get_my_developer_api_usage: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      get_my_referral_count: { Args: never; Returns: number }
      get_my_referrals: {
        Args: never
        Returns: {
          commission_earned: number
          id: string
          masked_name: string
          signup_date: string
          status: string
          username: string
        }[]
      }
      get_my_super_agent_pricing: { Args: never; Returns: Json }
      get_public_store: { Args: { p_slug: string }; Returns: Json }
      get_server_time: { Args: never; Returns: Json }
      get_store_analytics: {
        Args: { p_from: string; p_store_id: string; p_to: string }
        Returns: Json
      }
      handle_provider_refund: {
        Args: {
          p_amount?: number
          p_order_id: string
          p_provider_name?: string
          p_provider_reference?: string
          p_reason?: string
        }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_cross_network_authorized: {
        Args: { _customer_id: string }
        Returns: boolean
      }
      is_cross_network_bypass_customer: {
        Args: { p_customer_id: string }
        Returns: boolean
      }
      mark_payout_processing: {
        Args: {
          p_payout_id: string
          p_recipient_code: string
          p_response: Json
          p_transfer_code: string
          p_transfer_reference: string
        }
        Returns: Json
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      notify_super_admins: {
        Args: {
          _message: string
          _metadata: Json
          _title: string
          _type: string
        }
        Returns: undefined
      }
      payout_audit: {
        Args: {
          p_action: string
          p_actor_id: string
          p_actor_type: string
          p_details?: Json
          p_new_status: string
          p_payout_id: string
          p_prev_status: string
        }
        Returns: undefined
      }
      place_afa_guest_paystack: {
        Args: {
          p_affiliate_code: string
          p_buyer_email: string
          p_buyer_phone: string
          p_full_name: string
          p_location: string
          p_payment_reference: string
          p_registration_phone: string
        }
        Returns: Json
      }
      place_afa_paystack: {
        Args: {
          p_customer_id: string
          p_full_name: string
          p_location: string
          p_payment_reference: string
          p_registration_phone: string
        }
        Returns: Json
      }
      place_afa_wallet: {
        Args: {
          p_customer_id: string
          p_full_name: string
          p_location: string
          p_registration_phone: string
        }
        Returns: Json
      }
      place_developer_api_order: {
        Args: {
          p_client_reference?: string
          p_customer_id: string
          p_idempotency_key_hash: string
          p_package_id: string
          p_recipient_phone: string
        }
        Returns: Json
      }
      place_order: {
        Args: {
          p_bundle_size: string
          p_cost_price?: number
          p_customer_id: string
          p_delivery_mode?: string
          p_network: string
          p_provider_name?: string
          p_quantity: number
          p_recipient_phone: string
          p_total_amount: number
        }
        Returns: Json
      }
      place_order_guest_paystack: {
        Args: {
          p_affiliate_code?: string
          p_bundle_size: string
          p_buyer_email?: string
          p_buyer_phone: string
          p_cost_price?: number
          p_delivery_mode?: string
          p_network: string
          p_payment_reference: string
          p_provider_name?: string
          p_quantity: number
          p_recipient_phone: string
          p_total_amount: number
        }
        Returns: Json
      }
      place_order_paystack: {
        Args: {
          p_bundle_size: string
          p_cost_price?: number
          p_customer_id: string
          p_delivery_mode?: string
          p_network: string
          p_payment_reference: string
          p_provider_name?: string
          p_quantity: number
          p_recipient_phone: string
          p_total_amount: number
        }
        Returns: Json
      }
      place_store_afa_paystack: {
        Args: {
          p_affiliate_code?: string
          p_buyer_email?: string
          p_buyer_phone: string
          p_full_name: string
          p_location: string
          p_payment_reference: string
          p_registration_phone: string
          p_store_slug: string
        }
        Returns: Json
      }
      place_store_checker_paystack: {
        Args: {
          p_buyer_email?: string
          p_buyer_phone: string
          p_checker_product_id: string
          p_payment_reference: string
          p_quantity: number
          p_sms_phone?: string
          p_store_slug: string
        }
        Returns: Json
      }
      place_store_order_paystack: {
        Args: {
          p_buyer_email?: string
          p_buyer_phone: string
          p_payment_reference: string
          p_price_item_id: string
          p_quantity: number
          p_recipient_phone: string
          p_store_slug: string
        }
        Returns: Json
      }
      proceed_order_now: {
        Args: { p_customer_id: string; p_order_id: string }
        Returns: Json
      }
      purchase_checker:
        | {
            Args: {
              p_customer_id: string
              p_product_id: string
              p_sms_phone?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_customer_id: string
              p_product_id: string
              p_quantity?: number
              p_sms_phone?: string
            }
            Returns: Json
          }
      purchase_checker_guest_paystack: {
        Args: {
          p_affiliate_code: string
          p_buyer_email: string
          p_buyer_phone: string
          p_payment_reference: string
          p_product_id: string
          p_quantity: number
        }
        Returns: Json
      }
      purchase_checker_paystack:
        | {
            Args: {
              p_customer_id: string
              p_payment_reference: string
              p_product_id: string
              p_quantity?: number
              p_sms_phone?: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_customer_id: string
              p_payment_reference: string
              p_product_id: string
              p_quantity?: number
              p_sms_phone?: string
            }
            Returns: Json
          }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      request_affiliate_payout: {
        Args: {
          p_amount: number
          p_idempotency_key?: string
          p_momo_name: string
          p_momo_number: string
          p_network: string
        }
        Returns: Json
      }
      request_affiliate_withdrawal: {
        Args: { p_amount: number; p_momo_name: string; p_momo_number: string }
        Returns: Json
      }
      request_store_payout: {
        Args: {
          p_amount: number
          p_idempotency_key?: string
          p_momo_name: string
          p_momo_number: string
          p_network: string
        }
        Returns: Json
      }
      request_store_withdrawal: {
        Args: { p_amount: number; p_momo_name: string; p_momo_number: string }
        Returns: Json
      }
      revoke_customer_api_key: { Args: { p_key_id: string }; Returns: boolean }
      rotate_diagnostics_token: { Args: never; Returns: Json }
      set_diagnostics_window: {
        Args: { _duration_minutes: number; _enabled: boolean; _note: string }
        Returns: Json
      }
      set_disable_provider_diagnostics: {
        Args: { _disabled: boolean }
        Returns: Json
      }
      set_transaction_pin: {
        Args: { p_pin: string; p_user_id: string }
        Returns: undefined
      }
      sync_email_verified: { Args: never; Returns: undefined }
      track_checkout_initiation: {
        Args: {
          p_amount: number
          p_kind: string
          p_session_hash: string
          p_store_id: string
          p_store_product_id: string
          p_traffic_source?: string
        }
        Returns: undefined
      }
      track_product_click_v2: {
        Args: {
          p_session_hash: string
          p_store_id: string
          p_store_product_id: string
          p_traffic_source?: string
        }
        Returns: undefined
      }
      track_store_visit: {
        Args: {
          p_path: string
          p_referrer: string
          p_session_hash: string
          p_store_id: string
          p_traffic_source?: string
        }
        Returns: undefined
      }
      track_store_visit_v2: {
        Args: {
          p_path: string
          p_referrer: string
          p_session_hash: string
          p_store_id: string
          p_traffic_source?: string
          p_user_agent?: string
        }
        Returns: string
      }
      update_visit_duration: {
        Args: { p_seconds: number; p_visit_id: string }
        Returns: undefined
      }
      upsert_store_product:
        | {
            Args: {
              p_active?: boolean
              p_kind: string
              p_product_id: string
              p_selling_price: number
              p_store_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_active?: boolean
              p_price_item_id: string
              p_selling_price: number
              p_store_id: string
            }
            Returns: Json
          }
      verify_transaction_pin: {
        Args: { p_pin: string; p_user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      exam_type: "wassce" | "bece"
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
    Enums: {
      app_role: ["admin", "moderator", "user"],
      exam_type: ["wassce", "bece"],
    },
  },
} as const
