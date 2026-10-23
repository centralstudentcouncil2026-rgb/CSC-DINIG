-- Run with the Supabase database owner. Isolated schema; no changes to CSC apps.
BEGIN;
CREATE SCHEMA dinig;
CREATE ROLE dinig_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
DO $$ BEGIN EXECUTE format('GRANT dinig_runtime TO %I', current_user); END $$;
REVOKE ALL ON SCHEMA dinig FROM PUBLIC;
GRANT USAGE ON SCHEMA dinig TO dinig_runtime;

CREATE TABLE dinig.staff_profiles (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id), public_id uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(), display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 100),
 role text NOT NULL CHECK(role IN ('administrator','handler','restricted_reviewer')),
 enabled boolean NOT NULL DEFAULT true, sensitive_access boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dinig.routing_rules (
 category text PRIMARY KEY, restricted boolean NOT NULL DEFAULT false,
 reviewer_id uuid REFERENCES dinig.staff_profiles(user_id), target_hours integer CHECK(target_hours BETWEEN 1 AND 8760)
);
INSERT INTO dinig.routing_rules(category) VALUES ('Academic'),('Facilities'),('Student Services'),('Safety and Welfare'),('Organizations'),('Ideas and Suggestions'),('Others');
CREATE TABLE dinig.reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reference text UNIQUE NOT NULL,
 code_name text NOT NULL CHECK(length(code_name) BETWEEN 1 AND 80), category text NOT NULL REFERENCES dinig.routing_rules(category),
 subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 180), details text NOT NULL CHECK(length(details) BETWEEN 1 AND 12000),
 incident_date date, location text NOT NULL DEFAULT '', requested_action text NOT NULL DEFAULT '',
 sensitive boolean NOT NULL DEFAULT false, conflict_staff uuid[] NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'Submitted' CHECK(status IN ('Submitted','Under Review','Awaiting Student Response','In Progress','Referred','Resolved','Closed')),
 priority text NOT NULL DEFAULT 'Normal' CHECK(priority IN ('Low','Normal','High','Urgent')),
 resolution text NOT NULL DEFAULT '', review_requested boolean NOT NULL DEFAULT false,
 due_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dinig.report_access_credentials (
 report_id uuid PRIMARY KEY REFERENCES dinig.reports(id), code_hash text UNIQUE NOT NULL CHECK(length(code_hash)=64)
);
CREATE TABLE dinig.report_assignments (
 report_id uuid REFERENCES dinig.reports(id), staff_id uuid REFERENCES dinig.staff_profiles(user_id),
 assigned_by uuid REFERENCES dinig.staff_profiles(user_id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(report_id,staff_id)
);
CREATE TABLE dinig.report_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES dinig.reports(id),
 author_id uuid REFERENCES dinig.staff_profiles(user_id), author_type text NOT NULL CHECK(author_type IN ('student','staff')),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 8000), internal boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(NOT internal OR author_type='staff')
);
CREATE TABLE dinig.report_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES dinig.reports(id),
 message_id uuid REFERENCES dinig.report_messages(id), name text NOT NULL, mime text NOT NULL,
 content bytea NOT NULL, size integer NOT NULL CHECK(size BETWEEN 1 AND 5242880),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(octet_length(content)=size)
);
CREATE TABLE dinig.report_status_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES dinig.reports(id),
 previous_status text, new_status text NOT NULL, actor_id uuid REFERENCES dinig.staff_profiles(user_id),
 actor_type text NOT NULL, explanation text NOT NULL, student_visible boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dinig.report_referrals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES dinig.reports(id),
 office_id uuid NOT NULL, follow_up text NOT NULL, outcome text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dinig.approved_offices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, enabled boolean NOT NULL DEFAULT true);
ALTER TABLE dinig.report_referrals ADD FOREIGN KEY(office_id) REFERENCES dinig.approved_offices(id);
CREATE TABLE dinig.report_feedback (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES dinig.reports(id),
 kind text NOT NULL CHECK(kind IN ('confirmed','feedback','review_request')), body text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dinig.notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES dinig.reports(id),
 staff_id uuid NOT NULL REFERENCES dinig.staff_profiles(user_id), kind text NOT NULL,
 read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dinig.audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid REFERENCES dinig.reports(id),
 actor_id uuid REFERENCES dinig.staff_profiles(user_id), action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dinig.sessions (
 token_hash text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('student','staff')),
 report_id uuid REFERENCES dinig.reports(id), staff_id uuid REFERENCES dinig.staff_profiles(user_id),
 created_at timestamptz NOT NULL DEFAULT now(), touched_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 CHECK((kind='student' AND report_id IS NOT NULL AND staff_id IS NULL) OR (kind='staff' AND staff_id IS NOT NULL AND report_id IS NULL))
);
CREATE TABLE dinig.rate_limits (key text PRIMARY KEY, hits integer NOT NULL, reset_at timestamptz NOT NULL);
CREATE TABLE dinig.submission_keys (key uuid PRIMARY KEY, report_id uuid NOT NULL REFERENCES dinig.reports(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON dinig.reports(status,created_at DESC);
CREATE INDEX ON dinig.reports(category,priority);
CREATE INDEX ON dinig.report_assignments(staff_id,report_id);
CREATE INDEX ON dinig.report_messages(report_id,created_at);
CREATE INDEX ON dinig.report_status_history(report_id,created_at);
CREATE INDEX ON dinig.report_attachments(report_id);
CREATE INDEX ON dinig.notifications(staff_id,read_at);
CREATE INDEX ON dinig.sessions(expires_at);

-- These settings are assigned by the private server after checking its cookies.
-- SECURITY DEFINER is deliberately owned by the migration owner, bypassing
-- report-policy recursion. No browser/PostgREST role can execute these helpers.
CREATE FUNCTION dinig.can_access(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,dinig AS $$
 SELECT EXISTS(SELECT 1 FROM dinig.reports r WHERE r.id=target AND (
 r.id::text=nullif(current_setting('dinig.report_id',true),'') OR EXISTS(
 SELECT 1 FROM dinig.staff_profiles s WHERE s.user_id::text=nullif(current_setting('dinig.staff_id',true),'')
 AND s.enabled AND NOT(s.user_id=ANY(r.conflict_staff))
 AND ((NOT r.sensitive AND (s.role='administrator' OR EXISTS(SELECT 1 FROM dinig.report_assignments a WHERE a.report_id=r.id AND a.staff_id=s.user_id)))
 OR (r.sensitive AND s.sensitive_access AND EXISTS(SELECT 1 FROM dinig.report_assignments a WHERE a.report_id=r.id AND a.staff_id=s.user_id)))
 )))
$$;
REVOKE ALL ON FUNCTION dinig.can_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dinig.can_access(uuid) TO dinig_runtime;
ALTER TABLE dinig.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_read ON dinig.reports FOR SELECT TO dinig_runtime USING(dinig.can_access(id));
CREATE POLICY report_insert ON dinig.reports FOR INSERT TO dinig_runtime WITH CHECK(current_setting('dinig.creating',true)='yes');
CREATE POLICY report_update ON dinig.reports FOR UPDATE TO dinig_runtime USING(dinig.can_access(id)) WITH CHECK(dinig.can_access(id));
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['report_messages','report_attachments','report_status_history','report_assignments','report_referrals','report_feedback','notifications','audit_events'] LOOP
 EXECUTE format('ALTER TABLE dinig.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY report_access ON dinig.%I TO dinig_runtime USING(dinig.can_access(report_id)) WITH CHECK(dinig.can_access(report_id))',tab);
 END LOOP;
END $$;
-- DB additionally excludes internal content for report-scoped student sessions.
CREATE POLICY student_notes_block ON dinig.report_messages AS RESTRICTIVE TO dinig_runtime
 USING(NOT internal OR nullif(current_setting('dinig.staff_id',true),'') IS NOT NULL)
 WITH CHECK(NOT internal OR nullif(current_setting('dinig.staff_id',true),'') IS NOT NULL);
CREATE POLICY student_history_block ON dinig.report_status_history AS RESTRICTIVE TO dinig_runtime
 USING(student_visible OR nullif(current_setting('dinig.staff_id',true),'') IS NOT NULL);
CREATE POLICY settings_audit ON dinig.audit_events FOR INSERT TO dinig_runtime WITH CHECK(
 report_id IS NULL AND EXISTS(SELECT 1 FROM dinig.staff_profiles s WHERE s.user_id::text=nullif(current_setting('dinig.staff_id',true),'') AND s.enabled AND s.role='administrator')
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['report_referrals','report_assignments','notifications','audit_events'] LOOP
 EXECUTE format('CREATE POLICY staff_only ON dinig.%I AS RESTRICTIVE TO dinig_runtime USING(nullif(current_setting(''dinig.staff_id'',true),'''') IS NOT NULL OR current_setting(''dinig.creating'',true)=''yes'') WITH CHECK(nullif(current_setting(''dinig.staff_id'',true),'''') IS NOT NULL OR current_setting(''dinig.creating'',true)=''yes'')',tab);
 END LOOP;
END $$;
-- Private infrastructure is never exposed to anonymous/authenticated API roles.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['staff_profiles','routing_rules','approved_offices','sessions','rate_limits','submission_keys','report_access_credentials'] LOOP
 EXECUTE format('ALTER TABLE dinig.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY private_server ON dinig.%I TO dinig_runtime USING(true) WITH CHECK(true)',tab);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA dinig TO dinig_runtime;
REVOKE UPDATE,DELETE ON dinig.audit_events,dinig.report_status_history,dinig.report_messages,dinig.report_access_credentials FROM dinig_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA dinig FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA dinig FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dinig.can_access(uuid) TO dinig_runtime;
COMMIT;
