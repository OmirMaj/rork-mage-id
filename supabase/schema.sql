-- MAGE ID Supabase Database Schema
-- Run this in the Supabase SQL Editor

-- ============================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PROFILES (extends Supabase auth.users)
-- ============================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  company_name TEXT DEFAULT '',
  contact_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  license_number TEXT DEFAULT '',
  tagline TEXT DEFAULT '',
  logo_uri TEXT,
  signature_data JSONB,
  location TEXT DEFAULT 'United States',
  units TEXT DEFAULT 'imperial' CHECK (units IN ('imperial', 'metric')),
  tax_rate NUMERIC DEFAULT 7.5,
  contingency_rate NUMERIC DEFAULT 10,
  theme_colors JSONB,
  biometrics_enabled BOOLEAN DEFAULT FALSE,
  dfr_recipients JSONB DEFAULT '[]'::JSONB,
  onboarding_complete BOOLEAN DEFAULT FALSE,
  push_token TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- PROJECTS
-- ============================================
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  location TEXT DEFAULT '',
  square_footage NUMERIC DEFAULT 0,
  quality TEXT DEFAULT 'standard',
  description TEXT DEFAULT '',
  estimate JSONB,
  schedule JSONB,
  linked_estimate JSONB,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'estimated', 'in_progress', 'completed', 'closed')),
  collaborators JSONB DEFAULT '[]'::JSONB,
  client_portal JSONB,
  closed_at TIMESTAMPTZ,
  photo_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_projects_user_id ON public.projects(user_id);

CREATE TRIGGER projects_updated_at BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- CHANGE ORDERS
-- ============================================
CREATE TABLE IF NOT EXISTS public.change_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  date TEXT NOT NULL,
  description TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  line_items JSONB DEFAULT '[]'::JSONB,
  original_contract_value NUMERIC DEFAULT 0,
  change_amount NUMERIC DEFAULT 0,
  new_contract_total NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'draft',
  approvers JSONB,
  approval_mode TEXT DEFAULT 'sequential',
  approval_deadline_days INTEGER,
  audit_trail JSONB DEFAULT '[]'::JSONB,
  revision INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_change_orders_project ON public.change_orders(project_id);
CREATE INDEX idx_change_orders_user ON public.change_orders(user_id);

CREATE TRIGGER change_orders_updated_at BEFORE UPDATE ON public.change_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- INVOICES
-- ============================================
CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  type TEXT DEFAULT 'full' CHECK (type IN ('full', 'progress')),
  progress_percent NUMERIC,
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  payment_terms TEXT DEFAULT 'net_30',
  notes TEXT DEFAULT '',
  line_items JSONB DEFAULT '[]'::JSONB,
  subtotal NUMERIC DEFAULT 0,
  tax_rate NUMERIC DEFAULT 0,
  tax_amount NUMERIC DEFAULT 0,
  total_due NUMERIC DEFAULT 0,
  amount_paid NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'draft',
  payments JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invoices_project ON public.invoices(project_id);
CREATE INDEX idx_invoices_user ON public.invoices(user_id);

CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- DAILY FIELD REPORTS
-- ============================================
CREATE TABLE IF NOT EXISTS public.daily_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  weather JSONB DEFAULT '{}'::JSONB,
  manpower JSONB DEFAULT '[]'::JSONB,
  work_performed TEXT DEFAULT '',
  materials_delivered JSONB DEFAULT '[]'::JSONB,
  issues_and_delays TEXT DEFAULT '',
  photos JSONB DEFAULT '[]'::JSONB,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_daily_reports_project ON public.daily_reports(project_id);
CREATE INDEX idx_daily_reports_user ON public.daily_reports(user_id);

CREATE TRIGGER daily_reports_updated_at BEFORE UPDATE ON public.daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- SUBCONTRACTORS
-- ============================================
CREATE TABLE IF NOT EXISTS public.subcontractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  contact_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  trade TEXT DEFAULT 'General',
  license_number TEXT DEFAULT '',
  license_expiry TEXT DEFAULT '',
  coi_expiry TEXT DEFAULT '',
  w9_on_file BOOLEAN DEFAULT FALSE,
  bid_history JSONB DEFAULT '[]'::JSONB,
  assigned_projects JSONB DEFAULT '[]'::JSONB,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subcontractors_user ON public.subcontractors(user_id);

CREATE TRIGGER subcontractors_updated_at BEFORE UPDATE ON public.subcontractors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- PUNCH ITEMS
-- ============================================
CREATE TABLE IF NOT EXISTS public.punch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  location TEXT DEFAULT '',
  assigned_sub TEXT DEFAULT '',
  assigned_sub_id TEXT,
  due_date TEXT NOT NULL,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'ready_for_review', 'closed')),
  photo_uri TEXT,
  rejection_note TEXT,
  closed_at TIMESTAMPTZ,
  -- Location tracking (migration 20260707120000_punch_location.sql): additive + nullable.
  plan_sheet_id TEXT,
  pin_x DOUBLE PRECISION,
  pin_y DOUBLE PRECISION,
  photo_latitude DOUBLE PRECISION,
  photo_longitude DOUBLE PRECISION,
  photo_accuracy_meters DOUBLE PRECISION,
  photo_location_label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_punch_items_project ON public.punch_items(project_id);

CREATE TRIGGER punch_items_updated_at BEFORE UPDATE ON public.punch_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- WIP Reporting: additive period-snapshot table.
-- Live WIP is computed on the fly from existing financial tables; only these
-- frozen snapshots persist. locked_at makes a period immutable at the app
-- layer (CPA/bank close). Scoped by user_id (matches every tertiary_* table);
-- company_id is stored for future company-wide roll-ups but RLS is on user_id.
CREATE TABLE IF NOT EXISTS public.wip_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT,
  period_end_date TEXT NOT NULL,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  portfolio_totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  locked_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wip_periods_user ON public.wip_periods(user_id);

CREATE TRIGGER wip_periods_updated_at BEFORE UPDATE ON public.wip_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Lock immutability, enforced server-side (not just at the client). Once a
-- period is locked (locked_at IS NOT NULL) its financial payload is frozen for
-- the CPA/bank close — a stale offline client must not be able to overwrite it.
-- The only permitted mutation once locked is the updated_at bump the trigger
-- above makes; the initial NULL→timestamp lock transition is allowed because
-- OLD.locked_at IS NULL there. Any change to the snapshot fields (or re-locking)
-- RAISEs. Mirrors the invoice-immutability precedent.
CREATE OR REPLACE FUNCTION public.wip_periods_block_locked_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    IF (NEW.rows IS DISTINCT FROM OLD.rows)
       OR (NEW.portfolio_totals IS DISTINCT FROM OLD.portfolio_totals)
       OR (NEW.period_end_date IS DISTINCT FROM OLD.period_end_date)
       OR (NEW.notes IS DISTINCT FROM OLD.notes)
       OR (NEW.locked_at IS DISTINCT FROM OLD.locked_at) THEN
      RAISE EXCEPTION 'wip_periods: period % is locked and immutable', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wip_periods_block_locked_update BEFORE UPDATE ON public.wip_periods
  FOR EACH ROW EXECUTE FUNCTION public.wip_periods_block_locked_update();

ALTER TABLE public.wip_periods ENABLE ROW LEVEL SECURITY;

-- ============================================
-- SAFETY MANAGEMENT — Wave A
-- ============================================
CREATE TABLE IF NOT EXISTS public.jhas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  trade TEXT DEFAULT '',
  task_description TEXT DEFAULT '',
  date TEXT DEFAULT '',
  steps JSONB DEFAULT '[]'::JSONB,
  required_ppe JSONB DEFAULT '[]'::JSONB,
  sign_offs JSONB DEFAULT '[]'::JSONB,
  plan_sheet_id TEXT,
  pin_x DOUBLE PRECISION,
  pin_y DOUBLE PRECISION,
  ai_generated BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_jhas_project ON public.jhas(project_id);
CREATE TRIGGER jhas_updated_at BEFORE UPDATE ON public.jhas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.toolbox_talks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  date TEXT DEFAULT '',
  presenter TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  attachment_url TEXT,
  attendees JSONB DEFAULT '[]'::JSONB,
  ai_topic_source TEXT CHECK (ai_topic_source IN ('incident', 'hazard', 'weather', 'manual')),
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_toolbox_talks_project ON public.toolbox_talks(project_id);
CREATE TRIGGER toolbox_talks_updated_at BEFORE UPDATE ON public.toolbox_talks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.safety_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('injury', 'near_miss', 'property', 'environmental')),
  severity TEXT DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  occurred_at TEXT DEFAULT '',
  description TEXT DEFAULT '',
  location TEXT DEFAULT '',
  plan_sheet_id TEXT,
  pin_x DOUBLE PRECISION,
  pin_y DOUBLE PRECISION,
  people_involved JSONB DEFAULT '[]'::JSONB,
  photo_urls JSONB DEFAULT '[]'::JSONB,
  corrective_actions JSONB DEFAULT '[]'::JSONB,
  treatment TEXT DEFAULT 'none' CHECK (treatment IN ('none', 'first_aid', 'medical_beyond_first_aid')),
  days_away INTEGER DEFAULT 0,
  days_restricted INTEGER DEFAULT 0,
  restricted_duty BOOLEAN DEFAULT FALSE,
  lost_consciousness BOOLEAN DEFAULT FALSE,
  fatality BOOLEAN DEFAULT FALSE,
  osha_illness_type TEXT CHECK (osha_illness_type IN ('injury', 'skin', 'respiratory', 'poisoning', 'hearing', 'other_illness')),
  osha_recordable BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'closed')),
  reported_by TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_safety_incidents_project ON public.safety_incidents(project_id);
CREATE TRIGGER safety_incidents_updated_at BEFORE UPDATE ON public.safety_incidents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.hazards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  location TEXT DEFAULT '',
  photo_url TEXT,
  severity INTEGER DEFAULT 1 CHECK (severity BETWEEN 1 AND 5),
  likelihood INTEGER DEFAULT 1 CHECK (likelihood BETWEEN 1 AND 5),
  risk_score INTEGER DEFAULT 1,
  plan_sheet_id TEXT,
  pin_x DOUBLE PRECISION,
  pin_y DOUBLE PRECISION,
  assigned_to TEXT,
  due_date TEXT,
  corrective_action TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'mitigated', 'closed')),
  source_inspection_id TEXT,
  source_item_id TEXT,
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_hazards_project ON public.hazards(project_id);
CREATE TRIGGER hazards_updated_at BEFORE UPDATE ON public.hazards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- PROJECT PHOTOS
-- ============================================
CREATE TABLE IF NOT EXISTS public.photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  uri TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  location TEXT,
  tag TEXT,
  linked_task_id TEXT,
  linked_task_name TEXT,
  markup JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_photos_project ON public.photos(project_id);
CREATE INDEX idx_photos_user ON public.photos(user_id);

-- ============================================
-- RFIs
-- ============================================
CREATE TABLE IF NOT EXISTS public.rfis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  subject TEXT NOT NULL,
  question TEXT DEFAULT '',
  submitted_by TEXT DEFAULT '',
  assigned_to TEXT DEFAULT '',
  date_submitted TEXT NOT NULL,
  date_required TEXT NOT NULL,
  date_responded TEXT,
  response TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed', 'void')),
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'urgent')),
  linked_drawing TEXT,
  linked_task_id TEXT,
  attachments JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rfis_project ON public.rfis(project_id);

CREATE TRIGGER rfis_updated_at BEFORE UPDATE ON public.rfis
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- SUBMITTALS
-- ============================================
CREATE TABLE IF NOT EXISTS public.submittals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  spec_section TEXT DEFAULT '',
  submitted_by TEXT DEFAULT '',
  submitted_date TEXT NOT NULL,
  required_date TEXT NOT NULL,
  review_cycles JSONB DEFAULT '[]'::JSONB,
  current_status TEXT DEFAULT 'pending',
  attachments JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_submittals_project ON public.submittals(project_id);

CREATE TRIGGER submittals_updated_at BEFORE UPDATE ON public.submittals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- EQUIPMENT
-- ============================================
CREATE TABLE IF NOT EXISTS public.equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'owned' CHECK (type IN ('owned', 'rented')),
  category TEXT DEFAULT 'other',
  make TEXT DEFAULT '',
  model TEXT DEFAULT '',
  year INTEGER,
  serial_number TEXT,
  daily_rate NUMERIC DEFAULT 0,
  current_project_id TEXT,
  maintenance_schedule JSONB DEFAULT '[]'::JSONB,
  utilization_log JSONB DEFAULT '[]'::JSONB,
  status TEXT DEFAULT 'available' CHECK (status IN ('available', 'in_use', 'maintenance', 'retired')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_equipment_user ON public.equipment(user_id);

CREATE TRIGGER equipment_updated_at BEFORE UPDATE ON public.equipment
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- CONTACTS
-- ============================================
CREATE TABLE IF NOT EXISTS public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT DEFAULT '',
  company_name TEXT DEFAULT '',
  role TEXT DEFAULT 'Other',
  email TEXT DEFAULT '',
  secondary_email TEXT,
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  linked_project_ids JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_contacts_user ON public.contacts(user_id);

CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- PRICE ALERTS
-- ============================================
CREATE TABLE IF NOT EXISTS public.price_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL,
  material_name TEXT NOT NULL,
  target_price NUMERIC NOT NULL,
  direction TEXT DEFAULT 'below' CHECK (direction IN ('below', 'above')),
  current_price NUMERIC DEFAULT 0,
  is_triggered BOOLEAN DEFAULT FALSE,
  is_paused BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_price_alerts_user ON public.price_alerts(user_id);

-- ============================================
-- COMMUNICATION EVENTS
-- ============================================
CREATE TABLE IF NOT EXISTS public.comm_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  summary TEXT DEFAULT '',
  actor TEXT DEFAULT '',
  recipient TEXT,
  detail TEXT,
  is_private BOOLEAN DEFAULT FALSE,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comm_events_project ON public.comm_events(project_id);
CREATE INDEX idx_comm_events_user ON public.comm_events(user_id);

-- ============================================
-- PUBLIC BIDS (readable by everyone)
-- ============================================
CREATE TABLE IF NOT EXISTS public.public_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  issuing_agency TEXT DEFAULT '',
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  category TEXT DEFAULT 'construction',
  bid_type TEXT DEFAULT 'state',
  estimated_value NUMERIC DEFAULT 0,
  bond_required NUMERIC DEFAULT 0,
  deadline TEXT NOT NULL,
  description TEXT DEFAULT '',
  posted_by TEXT DEFAULT '',
  posted_date TEXT NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  required_certifications JSONB DEFAULT '[]'::JSONB,
  contact_email TEXT DEFAULT '',
  apply_url TEXT,
  source_url TEXT,
  source_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_public_bids_status ON public.public_bids(status);
CREATE INDEX idx_public_bids_state ON public.public_bids(state);

-- ============================================
-- COMPANIES (readable by everyone)
-- ============================================
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL,
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  primary_category TEXT DEFAULT 'construction',
  bond_capacity NUMERIC DEFAULT 0,
  completed_projects INTEGER DEFAULT 0,
  rating NUMERIC DEFAULT 0,
  contact_email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  description TEXT DEFAULT '',
  certifications JSONB DEFAULT '[]'::JSONB,
  website TEXT,
  year_established INTEGER,
  employee_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_companies_state ON public.companies(state);

-- ============================================
-- JOB LISTINGS
-- ============================================
CREATE TABLE IF NOT EXISTS public.job_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  company_id TEXT DEFAULT '',
  company_name TEXT DEFAULT '',
  title TEXT NOT NULL,
  trade_category TEXT NOT NULL,
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  pay_min NUMERIC DEFAULT 0,
  pay_max NUMERIC DEFAULT 0,
  pay_type TEXT DEFAULT 'hourly' CHECK (pay_type IN ('hourly', 'salary')),
  job_type TEXT DEFAULT 'full_time',
  required_licenses JSONB DEFAULT '[]'::JSONB,
  experience_level TEXT DEFAULT 'mid',
  description TEXT DEFAULT '',
  start_date TEXT DEFAULT '',
  posted_date TEXT NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed', 'filled')),
  applicant_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_job_listings_status ON public.job_listings(status);

-- ============================================
-- WORKER PROFILES
-- ============================================
CREATE TABLE IF NOT EXISTS public.worker_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  trade_category TEXT NOT NULL,
  years_experience INTEGER DEFAULT 0,
  licenses JSONB DEFAULT '[]'::JSONB,
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  availability TEXT DEFAULT 'available' CHECK (availability IN ('available', 'employed', 'open_to_offers')),
  hourly_rate NUMERIC DEFAULT 0,
  bio TEXT DEFAULT '',
  past_projects JSONB DEFAULT '[]'::JSONB,
  contact_email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_worker_profiles_trade ON public.worker_profiles(trade_category);

-- ============================================
-- CONVERSATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_ids JSONB NOT NULL DEFAULT '[]'::JSONB,
  participant_names JSONB NOT NULL DEFAULT '[]'::JSONB,
  last_message TEXT DEFAULT '',
  last_message_time TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- CONVERSATION PARTICIPANTS (junction table)
-- ============================================
CREATE TABLE IF NOT EXISTS public.conversation_participants (
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX idx_conversation_participants_user ON public.conversation_participants(user_id);

-- ============================================
-- MESSAGES
-- ============================================
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_name TEXT DEFAULT '',
  text TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON public.messages(conversation_id);
CREATE INDEX idx_messages_timestamp ON public.messages(timestamp);

-- ============================================
-- SUBSCRIPTIONS
-- ============================================
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'business')),
  revenuecat_customer_id TEXT,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user ON public.subscriptions(user_id);

-- ============================================
-- MATERIALS PRICING (regional)
-- ============================================
CREATE TABLE IF NOT EXISTS public.materials_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region TEXT NOT NULL,
  material_name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  retail_price NUMERIC NOT NULL,
  bulk_price NUMERIC NOT NULL,
  bulk_min_qty INTEGER DEFAULT 1,
  supplier TEXT DEFAULT '',
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(region, material_name)
);

CREATE INDEX idx_materials_region ON public.materials_pricing(region);

-- ============================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcontractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.punch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toolbox_talks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hazards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submittals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comm_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials_pricing ENABLE ROW LEVEL SECURITY;

-- PROFILES: users can only access their own
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- PROJECTS: owner access only
CREATE POLICY "projects_select_own" ON public.projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "projects_insert_own" ON public.projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "projects_update_own" ON public.projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "projects_delete_own" ON public.projects FOR DELETE USING (auth.uid() = user_id);

-- CHANGE ORDERS: owner access
CREATE POLICY "co_select_own" ON public.change_orders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "co_insert_own" ON public.change_orders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "co_update_own" ON public.change_orders FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "co_delete_own" ON public.change_orders FOR DELETE USING (auth.uid() = user_id);

-- INVOICES: owner access
CREATE POLICY "inv_select_own" ON public.invoices FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "inv_insert_own" ON public.invoices FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "inv_update_own" ON public.invoices FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "inv_delete_own" ON public.invoices FOR DELETE USING (auth.uid() = user_id);

-- DAILY REPORTS: owner access
CREATE POLICY "dfr_select_own" ON public.daily_reports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "dfr_insert_own" ON public.daily_reports FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "dfr_update_own" ON public.daily_reports FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "dfr_delete_own" ON public.daily_reports FOR DELETE USING (auth.uid() = user_id);

-- SUBCONTRACTORS: owner access
CREATE POLICY "subs_select_own" ON public.subcontractors FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "subs_insert_own" ON public.subcontractors FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "subs_update_own" ON public.subcontractors FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "subs_delete_own" ON public.subcontractors FOR DELETE USING (auth.uid() = user_id);

-- PUNCH ITEMS: owner access
CREATE POLICY "punch_select_own" ON public.punch_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "punch_insert_own" ON public.punch_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "punch_update_own" ON public.punch_items FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "punch_delete_own" ON public.punch_items FOR DELETE USING (auth.uid() = user_id);

-- WIP PERIODS: owner access
CREATE POLICY "wip_periods_select_own" ON public.wip_periods
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "wip_periods_insert_own" ON public.wip_periods
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "wip_periods_update_own" ON public.wip_periods
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "wip_periods_delete_own" ON public.wip_periods
  FOR DELETE USING (auth.uid() = user_id);

-- Safety Wave A policies
CREATE POLICY "jhas_select_own" ON public.jhas FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "jhas_insert_own" ON public.jhas FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "jhas_update_own" ON public.jhas FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "jhas_delete_own" ON public.jhas FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "toolbox_select_own" ON public.toolbox_talks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "toolbox_insert_own" ON public.toolbox_talks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "toolbox_update_own" ON public.toolbox_talks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "toolbox_delete_own" ON public.toolbox_talks FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "incidents_select_own" ON public.safety_incidents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "incidents_insert_own" ON public.safety_incidents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "incidents_update_own" ON public.safety_incidents FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "incidents_delete_own" ON public.safety_incidents FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "hazards_select_own" ON public.hazards FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "hazards_insert_own" ON public.hazards FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "hazards_update_own" ON public.hazards FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "hazards_delete_own" ON public.hazards FOR DELETE USING (auth.uid() = user_id);

-- PHOTOS: owner access
CREATE POLICY "photos_select_own" ON public.photos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "photos_insert_own" ON public.photos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "photos_delete_own" ON public.photos FOR DELETE USING (auth.uid() = user_id);

-- RFIs: owner access
CREATE POLICY "rfis_select_own" ON public.rfis FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "rfis_insert_own" ON public.rfis FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "rfis_update_own" ON public.rfis FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "rfis_delete_own" ON public.rfis FOR DELETE USING (auth.uid() = user_id);

-- SUBMITTALS: owner access
CREATE POLICY "submittals_select_own" ON public.submittals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "submittals_insert_own" ON public.submittals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "submittals_update_own" ON public.submittals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "submittals_delete_own" ON public.submittals FOR DELETE USING (auth.uid() = user_id);

-- EQUIPMENT: owner access
CREATE POLICY "equip_select_own" ON public.equipment FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "equip_insert_own" ON public.equipment FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "equip_update_own" ON public.equipment FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "equip_delete_own" ON public.equipment FOR DELETE USING (auth.uid() = user_id);

-- CONTACTS: owner access
CREATE POLICY "contacts_select_own" ON public.contacts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "contacts_insert_own" ON public.contacts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "contacts_update_own" ON public.contacts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "contacts_delete_own" ON public.contacts FOR DELETE USING (auth.uid() = user_id);

-- PRICE ALERTS: owner access
CREATE POLICY "alerts_select_own" ON public.price_alerts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "alerts_insert_own" ON public.price_alerts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "alerts_update_own" ON public.price_alerts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "alerts_delete_own" ON public.price_alerts FOR DELETE USING (auth.uid() = user_id);

-- COMM EVENTS: owner access
CREATE POLICY "comm_select_own" ON public.comm_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "comm_insert_own" ON public.comm_events FOR INSERT WITH CHECK (auth.uid() = user_id);

-- PUBLIC BIDS: readable by ALL authenticated users, writable by owner
CREATE POLICY "bids_select_all" ON public.public_bids FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "bids_insert_auth" ON public.public_bids FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bids_update_own" ON public.public_bids FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "bids_delete_own" ON public.public_bids FOR DELETE USING (auth.uid() = user_id);

-- COMPANIES: readable by ALL authenticated users, writable by owner
CREATE POLICY "companies_select_all" ON public.companies FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "companies_insert_auth" ON public.companies FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "companies_update_own" ON public.companies FOR UPDATE USING (auth.uid() = user_id);

-- JOB LISTINGS: readable by all authenticated, writable by owner
CREATE POLICY "jobs_select_all" ON public.job_listings FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "jobs_insert_auth" ON public.job_listings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "jobs_update_own" ON public.job_listings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "jobs_delete_own" ON public.job_listings FOR DELETE USING (auth.uid() = user_id);

-- WORKER PROFILES: readable by all authenticated, writable by owner
CREATE POLICY "workers_select_all" ON public.worker_profiles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "workers_insert_auth" ON public.worker_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "workers_update_own" ON public.worker_profiles FOR UPDATE USING (auth.uid() = user_id);

-- CONVERSATION PARTICIPANTS: participants can access their own rows
CREATE POLICY "cp_select_own" ON public.conversation_participants FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "cp_insert_auth" ON public.conversation_participants FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "cp_delete_own" ON public.conversation_participants FOR DELETE USING (auth.uid() = user_id);

-- CONVERSATIONS: participants can access via junction table
CREATE POLICY "convo_select_participant" ON public.conversations FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = id AND cp.user_id = auth.uid()
  )
);
CREATE POLICY "convo_insert_auth" ON public.conversations FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "convo_update_participant" ON public.conversations FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = id AND cp.user_id = auth.uid()
  )
);

-- MESSAGES: participants of the conversation can access via junction table
CREATE POLICY "msg_select_convo" ON public.messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.conversation_participants cp
    WHERE cp.conversation_id = conversation_id AND cp.user_id = auth.uid()
  )
);
CREATE POLICY "msg_insert_auth" ON public.messages FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- SUBSCRIPTIONS: owner access
CREATE POLICY "subs_tier_select_own" ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "subs_tier_insert_own" ON public.subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "subs_tier_update_own" ON public.subscriptions FOR UPDATE USING (auth.uid() = user_id);

-- MATERIALS PRICING: readable by all authenticated
CREATE POLICY "materials_select_all" ON public.materials_pricing FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================
-- SUPABASE STORAGE BUCKETS (policies)
-- ============================================

-- Bucket: project-photos
INSERT INTO storage.buckets (id, name, public) VALUES ('project-photos', 'project-photos', false) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "project_photos_upload" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'project-photos' AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::TEXT
);
CREATE POLICY "project_photos_select" ON storage.objects FOR SELECT USING (
  bucket_id = 'project-photos' AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::TEXT
);
CREATE POLICY "project_photos_delete" ON storage.objects FOR DELETE USING (
  bucket_id = 'project-photos' AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::TEXT
);

-- Bucket: documents
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "documents_upload" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'documents' AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::TEXT
);
CREATE POLICY "documents_select" ON storage.objects FOR SELECT USING (
  bucket_id = 'documents' AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::TEXT
);
CREATE POLICY "documents_delete" ON storage.objects FOR DELETE USING (
  bucket_id = 'documents' AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::TEXT
);

-- Bucket: branding
INSERT INTO storage.buckets (id, name, public) VALUES ('branding', 'branding', false) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "branding_upload" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'branding' AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::TEXT
);
CREATE POLICY "branding_select" ON storage.objects FOR SELECT USING (
  bucket_id = 'branding' AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::TEXT
);
CREATE POLICY "branding_delete" ON storage.objects FOR DELETE USING (
  bucket_id = 'branding' AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::TEXT
);

-- Bucket: profiles (public read for profile images)
INSERT INTO storage.buckets (id, name, public) VALUES ('profiles', 'profiles', true) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "profiles_upload" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'profiles' AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::TEXT
);
CREATE POLICY "profiles_select_public" ON storage.objects FOR SELECT USING (
  bucket_id = 'profiles'
);
CREATE POLICY "profiles_delete" ON storage.objects FOR DELETE USING (
  bucket_id = 'profiles' AND auth.role() = 'authenticated'
  AND (storage.foldername(name))[1] = auth.uid()::TEXT
);

-- ============================================
-- ENHANCED CACHED_BIDS (add columns)
-- ============================================
ALTER TABLE cached_bids
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS bid_type TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'construction',
  ADD COLUMN IF NOT EXISTS bond_required NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS apply_url TEXT,
  ADD COLUMN IF NOT EXISTS source_name TEXT,
  ADD COLUMN IF NOT EXISTS posted_by TEXT,
  ADD COLUMN IF NOT EXISTS naics_code TEXT,
  ADD COLUMN IF NOT EXISTS solicitation_number TEXT,
  ADD COLUMN IF NOT EXISTS pre_bid_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pre_bid_location TEXT,
  ADD COLUMN IF NOT EXISTS scope_of_work TEXT,
  ADD COLUMN IF NOT EXISTS documents_url TEXT,
  ADD COLUMN IF NOT EXISTS required_certifications TEXT[] DEFAULT '{}';

-- ============================================
-- USER TRACKED BIDS
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_tracked_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  bid_id TEXT NOT NULL,
  status TEXT DEFAULT 'saved' CHECK (status IN ('saved', 'interested', 'preparing', 'submitted', 'won', 'lost')),
  notes TEXT,
  proposal_amount NUMERIC,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_tracked_bids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tracked_bids_all_own" ON public.user_tracked_bids FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_tracked_bids_user ON public.user_tracked_bids(user_id, status);

CREATE TRIGGER user_tracked_bids_updated_at BEFORE UPDATE ON public.user_tracked_bids
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- MATERIAL PRICES CACHE (for future live pricing)
-- ============================================
CREATE TABLE IF NOT EXISTS public.material_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_key TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT,
  price NUMERIC NOT NULL,
  bulk_price NUMERIC,
  store_name TEXT,
  store_zip TEXT,
  sku TEXT,
  product_url TEXT,
  image_url TEXT,
  source TEXT DEFAULT 'home_depot',
  region TEXT,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  UNIQUE(material_key, store_zip, source)
);

ALTER TABLE public.material_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "material_prices_select_all" ON public.material_prices FOR SELECT USING (auth.role() = 'authenticated');
CREATE INDEX IF NOT EXISTS idx_material_prices_lookup ON public.material_prices(material_key, store_zip) WHERE expires_at > NOW();

-- ============================================
-- LABOR RATES
-- ============================================
CREATE TABLE IF NOT EXISTS public.labor_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade TEXT NOT NULL,
  region TEXT NOT NULL,
  state TEXT,
  metro_area TEXT,
  hourly_rate_low NUMERIC,
  hourly_rate_median NUMERIC,
  hourly_rate_high NUMERIC,
  source TEXT DEFAULT 'bls_oews',
  data_year INTEGER,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.labor_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "labor_rates_select_all" ON public.labor_rates FOR SELECT USING (auth.role() = 'authenticated');
CREATE INDEX IF NOT EXISTS idx_labor_rates_trade_region ON public.labor_rates(trade, region);

-- ============================================
-- ASSEMBLIES (custom user assemblies)
-- ============================================
CREATE TABLE IF NOT EXISTS public.assemblies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  unit TEXT NOT NULL,
  materials JSONB NOT NULL DEFAULT '[]',
  labor JSONB NOT NULL DEFAULT '[]',
  notes TEXT,
  is_custom BOOLEAN DEFAULT false,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.assemblies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assemblies_select_all" ON public.assemblies FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "assemblies_insert_own" ON public.assemblies FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "assemblies_update_own" ON public.assemblies FOR UPDATE USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_assemblies_category ON public.assemblies(category);

-- ============================================
-- ZIP COST FACTORS
-- ============================================
CREATE TABLE IF NOT EXISTS public.zip_cost_factors (
  zip_prefix TEXT PRIMARY KEY,
  region TEXT,
  city TEXT,
  state TEXT,
  cost_factor NUMERIC DEFAULT 1.0,
  labor_factor NUMERIC DEFAULT 1.0,
  material_factor NUMERIC DEFAULT 1.0,
  source TEXT DEFAULT 'derived',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.zip_cost_factors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zip_factors_select_all" ON public.zip_cost_factors FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================
-- ESTIMATE VERSIONS
-- ============================================
CREATE TABLE IF NOT EXISTS public.estimate_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  version_number INTEGER DEFAULT 1,
  name TEXT,
  notes TEXT,
  estimate_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.estimate_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "estimate_versions_all_own" ON public.estimate_versions FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- PLAN SHEETS, DRAWING PINS, MARKUPS, CALIBRATIONS
-- ============================================
-- Full schema in supabase/migrations/add_plans_sync.sql. Also inlined here
-- so fresh installs running schema.sql end-to-end pick these up.
CREATE TABLE IF NOT EXISTS public.plan_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  sheet_number TEXT,
  image_uri TEXT NOT NULL,
  page_number INTEGER,
  width NUMERIC,
  height NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plan_sheets_project ON public.plan_sheets(project_id);
CREATE INDEX IF NOT EXISTS idx_plan_sheets_user ON public.plan_sheets(user_id);
CREATE TRIGGER plan_sheets_updated_at BEFORE UPDATE ON public.plan_sheets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.plan_sheets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plan_sheets_all_own" ON public.plan_sheets
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.drawing_pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  plan_sheet_id UUID NOT NULL REFERENCES public.plan_sheets(id) ON DELETE CASCADE,
  x NUMERIC NOT NULL,
  y NUMERIC NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('note', 'photo', 'punch', 'rfi')),
  label TEXT,
  color TEXT,
  linked_photo_id UUID,
  linked_punch_item_id UUID,
  linked_rfi_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_drawing_pins_sheet ON public.drawing_pins(plan_sheet_id);
CREATE INDEX IF NOT EXISTS idx_drawing_pins_project ON public.drawing_pins(project_id);
CREATE INDEX IF NOT EXISTS idx_drawing_pins_user ON public.drawing_pins(user_id);
CREATE TRIGGER drawing_pins_updated_at BEFORE UPDATE ON public.drawing_pins
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.drawing_pins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drawing_pins_all_own" ON public.drawing_pins
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.plan_markups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  plan_sheet_id UUID NOT NULL REFERENCES public.plan_sheets(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('arrow', 'rectangle', 'circle', 'freehand', 'text')),
  color TEXT NOT NULL DEFAULT '#FF0000',
  stroke_width NUMERIC,
  points JSONB NOT NULL DEFAULT '[]'::JSONB,
  text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plan_markups_sheet ON public.plan_markups(plan_sheet_id);
CREATE INDEX IF NOT EXISTS idx_plan_markups_project ON public.plan_markups(project_id);
CREATE INDEX IF NOT EXISTS idx_plan_markups_user ON public.plan_markups(user_id);
ALTER TABLE public.plan_markups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plan_markups_all_own" ON public.plan_markups
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.plan_calibrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  plan_sheet_id UUID NOT NULL UNIQUE REFERENCES public.plan_sheets(id) ON DELETE CASCADE,
  p1 JSONB NOT NULL,
  p2 JSONB NOT NULL,
  real_distance_ft NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plan_calibrations_sheet ON public.plan_calibrations(plan_sheet_id);
CREATE INDEX IF NOT EXISTS idx_plan_calibrations_user ON public.plan_calibrations(user_id);
ALTER TABLE public.plan_calibrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plan_calibrations_all_own" ON public.plan_calibrations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================
-- SAFETY MANAGEMENT — Wave B (inspections, certifications, templates)
-- Mirror of supabase/migrations/20260708180000_safety_wave_b.sql.
-- Additive, RLS-scoped. Triggers/updated_at fn omitted here to keep
-- schema.sql declarative (matching how other tables are mirrored).
-- ============================================
CREATE TABLE IF NOT EXISTS public.safety_inspections (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  template_id text,
  title text NOT NULL DEFAULT '',
  date text NOT NULL DEFAULT '',
  inspector text NOT NULL DEFAULT '',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  score numeric(4,3) NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'complete' CHECK (status IN ('draft','complete')),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS safety_inspections_user_idx ON public.safety_inspections(user_id);
CREATE INDEX IF NOT EXISTS safety_inspections_project_idx ON public.safety_inspections(project_id);
ALTER TABLE public.safety_inspections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "safety_inspections_all_own" ON public.safety_inspections;
CREATE POLICY "safety_inspections_all_own" ON public.safety_inspections
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.safety_inspections TO authenticated;

CREATE TABLE IF NOT EXISTS public.certifications (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  worker_id text,               -- → crew_members.id (person anchor); nullable, cert may predate the roster entry. NO FK: keeps the offline queue from failing when a cert syncs before its CrewMember row.
  holder_name text,             -- display fallback when worker_id is null (nullable now that CrewMember is the anchor)
  sub_id text,
  type text NOT NULL DEFAULT '',
  issued_date text,
  expires_date text,
  document_url text,
  status text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','expiring','expired')),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS certifications_user_idx ON public.certifications(user_id);
CREATE INDEX IF NOT EXISTS certifications_worker_idx ON public.certifications(worker_id);
CREATE INDEX IF NOT EXISTS certifications_sub_idx ON public.certifications(sub_id);
ALTER TABLE public.certifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "certifications_all_own" ON public.certifications;
CREATE POLICY "certifications_all_own" ON public.certifications
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.certifications TO authenticated;

CREATE TABLE IF NOT EXISTS public.safety_templates (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'general' CHECK (category IN ('jha','inspection','general')),
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS safety_templates_user_idx ON public.safety_templates(user_id);
ALTER TABLE public.safety_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "safety_templates_all_own" ON public.safety_templates;
CREATE POLICY "safety_templates_all_own" ON public.safety_templates
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.safety_templates TO authenticated;

-- ============================================
-- ENABLE REALTIME
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.public_bids;
ALTER PUBLICATION supabase_realtime ADD TABLE public.change_orders;

-- ============================================
-- TRIGGER: auto-create profile on signup
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'name', '')
  );
  INSERT INTO public.subscriptions (user_id, tier)
  VALUES (NEW.id, 'free');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- CREW MEMBERS
-- ============================================
-- Worker Profile — CrewMember roster. Additive, company-scoped.
-- RLS: owning GC (auth.uid() = user_id) OR claimed worker
-- (auth.uid() = claimed_by_user_id) for SELECT/UPDATE; only the GC INSERTs and
-- DELETEs. Mirror of supabase/migrations/20260708130000_crew_members.sql.
CREATE TABLE IF NOT EXISTS public.crew_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  trades JSONB DEFAULT '[]'::JSONB,
  phone TEXT,
  email TEXT,
  photo_url TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  -- ID verification (extract-then-purge default: masked/derived fields only)
  id_verified BOOLEAN DEFAULT FALSE,
  id_type TEXT CHECK (id_type IN ('drivers_license', 'state_id', 'passport', 'other')),
  id_masked_last4 TEXT,
  id_expiry TEXT,
  id_issuer TEXT,
  id_scanned_at TIMESTAMPTZ,
  -- Present ONLY on opt-in retain: a PATH in the private worker-ids bucket.
  id_image_path TEXT,
  -- Claim (hybrid ownership)
  claim_token TEXT UNIQUE,
  claimed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  is_public BOOLEAN DEFAULT FALSE,
  marketplace_profile_id UUID,
  project_ids JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crew_members_user ON public.crew_members(user_id);
CREATE INDEX IF NOT EXISTS idx_crew_members_claimed ON public.crew_members(claimed_by_user_id);
CREATE INDEX IF NOT EXISTS idx_crew_members_claim_token ON public.crew_members(claim_token);

ALTER TABLE public.crew_members ENABLE ROW LEVEL SECURITY;

-- SELECT: owning GC or the claimed worker.
CREATE POLICY "crew_select_own_or_claimed" ON public.crew_members
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() = claimed_by_user_id);
-- INSERT: only the owning GC.
CREATE POLICY "crew_insert_own" ON public.crew_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);
-- UPDATE: owning GC or the claimed worker (self-edit path is not tier-gated).
-- WITH CHECK re-validates the NEW row so an update cannot move a row outside
-- owner-or-claimed visibility. CRITICAL: WITH CHECK alone does NOT stop a
-- claimed worker from hijacking ownership — they could set user_id = auth.uid()
-- and the NEW row would still satisfy the OR clause, silently dropping the row
-- out of the GC's user_id-scoped SELECT/UPDATE/DELETE policies (compliance
-- roster). The crew_freeze_ownership_columns BEFORE-UPDATE trigger below closes
-- that by freezing ownership + claim + all GC-owned ID/verification/marketplace
-- columns for any authenticated caller who is not the owning GC (only phone,
-- email, photo_url, trades, is_public stay worker-writable). Service-role /
-- trusted-backend writes (auth.uid() IS NULL) are exempt and bypass RLS as usual.
CREATE POLICY "crew_update_own_or_claimed" ON public.crew_members
  FOR UPDATE
  USING (auth.uid() = user_id OR auth.uid() = claimed_by_user_id)
  WITH CHECK (auth.uid() = user_id OR auth.uid() = claimed_by_user_id);
-- DELETE: only the owning GC.
CREATE POLICY "crew_delete_own" ON public.crew_members
  FOR DELETE USING (auth.uid() = user_id);

-- Freeze GC/system-owned columns against a claimed worker's self-edit. A BEFORE
-- trigger's NEW row is what RLS WITH CHECK ultimately validates, so restoring
-- these from OLD defeats the USING-clause escalation AND forgery of
-- GC-controlled compliance state. For a non-owner caller (the claimed worker),
-- ONLY genuinely worker-owned fields stay writable: phone, email, photo_url,
-- trades, is_public. Everything else is restored:
--   • user_id / claimed_by_user_id / claimed_at / claim_token — ownership +
--     single-use claim state (prevents hijack and token re-mint).
--   • id_verified / id_type / id_masked_last4 / id_expiry / id_issuer /
--     id_scanned_at / id_image_path — the GC creates these from a real scan; a
--     raw client PATCH must never forge the "ID Verified" badge or point
--     id_image_path at an arbitrary path in the private worker-ids bucket.
--   • marketplace_profile_id — the Hire listing identity; worker-set values
--     could collide with / shadow another worker's marketplace profile once
--     HIRE_ENABLED flips. Only the GC / service role may set it.
--   • full_name / status / project_ids — GC-controlled roster + assignment
--     state. full_name is the identity shown on the compliance roster / JHA
--     sign-offs and the person anchor for certifications; status (active/
--     inactive) and project_ids (which projects the worker is assigned to)
--     are the GC's call, not the worker's. A raw client PATCH must never let a
--     claimed worker rename themselves, flip their own status, or self-assign
--     to a GC project.
-- Any legitimate worker self-scan must go through a service-role edge function
-- (auth.uid() IS NULL, exempt below) that validates a fresh scan — never a raw
-- client PATCH.
CREATE OR REPLACE FUNCTION public.crew_freeze_ownership_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM OLD.user_id THEN
    NEW.user_id := OLD.user_id;
    NEW.claimed_by_user_id := OLD.claimed_by_user_id;
    NEW.claimed_at := OLD.claimed_at;
    NEW.claim_token := OLD.claim_token;
    NEW.id_verified := OLD.id_verified;
    NEW.id_type := OLD.id_type;
    NEW.id_masked_last4 := OLD.id_masked_last4;
    NEW.id_expiry := OLD.id_expiry;
    NEW.id_issuer := OLD.id_issuer;
    NEW.id_scanned_at := OLD.id_scanned_at;
    NEW.id_image_path := OLD.id_image_path;
    NEW.marketplace_profile_id := OLD.marketplace_profile_id;
    NEW.full_name := OLD.full_name;
    NEW.status := OLD.status;
    NEW.project_ids := OLD.project_ids;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER crew_members_freeze_ownership BEFORE UPDATE ON public.crew_members
  FOR EACH ROW EXECUTE FUNCTION public.crew_freeze_ownership_columns();

CREATE TRIGGER crew_members_updated_at BEFORE UPDATE ON public.crew_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- SCAN ANYTHING — scan_records audit log
-- ============================================
-- scan_records: audit log of Scan-Anything captures. Additive, owner-scoped.
CREATE TABLE IF NOT EXISTS public.scan_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  file_path TEXT NOT NULL DEFAULT '',
  record_kind TEXT NOT NULL DEFAULT 'file_only',
  linked_record_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scan_records_user ON public.scan_records(user_id);
CREATE INDEX IF NOT EXISTS idx_scan_records_project ON public.scan_records(project_id);
ALTER TABLE public.scan_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scan_records_select_own" ON public.scan_records FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "scan_records_insert_own" ON public.scan_records FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "scan_records_update_own" ON public.scan_records FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "scan_records_delete_own" ON public.scan_records FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER scan_records_updated_at BEFORE UPDATE ON public.scan_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
