export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          sf_user_id: string | null;
          role: "commercial" | "manager";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          sf_user_id?: string | null;
          role?: "commercial" | "manager";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          sf_user_id?: string | null;
          role?: "commercial" | "manager";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          id: number;
          key: string;
          value: Json;
          updated_at: string;
        };
        Insert: {
          id?: number;
          key: string;
          value?: Json;
          updated_at?: string;
        };
        Update: {
          id?: number;
          key?: string;
          value?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      challenges: {
        Row: {
          id: number;
          title: string;
          metric: string;
          period: "weekly" | "monthly" | "custom";
          status: "draft" | "active" | "archived";
          creator: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          title: string;
          metric: string;
          period?: "weekly" | "monthly" | "custom";
          status?: "draft" | "active" | "archived";
          creator: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          title?: string;
          metric?: string;
          period?: "weekly" | "monthly" | "custom";
          status?: "draft" | "active" | "archived";
          creator?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "challenges_creator_fkey";
            columns: ["creator"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      challenge_results: {
        Row: {
          id: number;
          challenge_id: number;
          profile_id: string;
          value: number;
          rank: number | null;
          updated_at: string;
        };
        Insert: {
          id?: number;
          challenge_id: number;
          profile_id: string;
          value?: number;
          rank?: number | null;
          updated_at?: string;
        };
        Update: {
          id?: number;
          challenge_id?: number;
          profile_id?: string;
          value?: number;
          rank?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "challenge_results_challenge_id_fkey";
            columns: ["challenge_id"];
            referencedRelation: "challenges";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "challenge_results_profile_id_fkey";
            columns: ["profile_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      badges: {
        Row: {
          id: number;
          profile_id: string;
          type: string;
          date: string;
          meta: Json;
        };
        Insert: {
          id?: number;
          profile_id: string;
          type: string;
          date?: string;
          meta?: Json;
        };
        Update: {
          id?: number;
          profile_id?: string;
          type?: string;
          date?: string;
          meta?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "badges_profile_id_fkey";
            columns: ["profile_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      action_journal: {
        Row: {
          id: number;
          at: string;
          actor: string;
          action_type: string;
          changes: Json;
          targets: Json;
          result: Json;
        };
        Insert: {
          id?: number;
          at?: string;
          actor: string;
          action_type: string;
          changes?: Json;
          targets?: Json;
          result?: Json;
        };
        Update: {
          id?: number;
          at?: string;
          actor?: string;
          action_type?: string;
          changes?: Json;
          targets?: Json;
          result?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "action_journal_actor_fkey";
            columns: ["actor"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
