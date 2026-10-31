-- Rate limiting เก็บที่เซิร์ฟเวอร์ (แทนที่จะเก็บแค่ในหน่วยความจำของเครื่อง)
-- ป้องกันการพยายามเดารหัสผ่านหรือชื่อผู้ใช้ซ้ำๆ หลายครั้ง

CREATE TABLE IF NOT EXISTS public.rate_limit_entries (
    key          text PRIMARY KEY,
    count        integer NOT NULL DEFAULT 0,
    first_attempt timestamptz NOT NULL DEFAULT now(),
    locked_until  timestamptz
);

ALTER TABLE public.rate_limit_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rate_limit_entries_all ON public.rate_limit_entries;
-- Server action (ผ่าน service_role / authenticated session) อ่านและเขียนได้ทั้งหมด
CREATE POLICY rate_limit_entries_all ON public.rate_limit_entries
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);
REVOKE ALL ON public.rate_limit_entries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.rate_limit_entries TO authenticated;
GRANT ALL ON public.rate_limit_entries TO service_role;

-- ฟังก์ชันเช็คว่า key นี้ถูกล็อกอยู่หรือไม่ (คืนค่า locked_until ถ้ายังล็อกอยู่, NULL ถ้าไม่ล็อก)
CREATE OR REPLACE FUNCTION public.rate_limit_is_locked(p_key text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_locked timestamptz;
BEGIN
    SELECT locked_until INTO v_locked
    FROM public.rate_limit_entries
    WHERE key = p_key;

    IF v_locked IS NULL THEN
        RETURN NULL;
    END IF;

    IF v_locked > now() THEN
        RETURN v_locked;
    ELSE
        -- หมดเวลาล็อกแล้ว ล้างทิ้ง
        DELETE FROM public.rate_limit_entries WHERE key = p_key;
        RETURN NULL;
    END IF;
END;
$$;

-- ฟังก์ชันบันทึกความพยายามที่ล้มเหลว (เพิ่มนับ, ล็อกถ้าครบจำนวนที่กำหนด)
CREATE OR REPLACE FUNCTION public.rate_limit_record_failure(p_key text, p_max_attempts integer, p_window_seconds integer, p_lockout_seconds integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now timestamptz := now();
    v_entry public.rate_limit_entries%ROWTYPE;
BEGIN
    SELECT * INTO v_entry FROM public.rate_limit_entries WHERE key = p_key;

    IF NOT FOUND THEN
        INSERT INTO public.rate_limit_entries (key, count, first_attempt, locked_until)
        VALUES (p_key, 1, v_now, NULL);
        RETURN;
    END IF;

    -- ถ้าเกินช่วงเวลาที่กำหนด ให้เริ่มนับใหม่
    IF v_entry.first_attempt + (p_window_seconds || ' seconds')::interval < v_now THEN
        UPDATE public.rate_limit_entries
        SET count = 1, first_attempt = v_now, locked_until = NULL
        WHERE key = p_key;
        RETURN;
    END IF;

    v_entry.count := v_entry.count + 1;

    IF v_entry.count >= p_max_attempts THEN
        UPDATE public.rate_limit_entries
        SET count = v_entry.count, locked_until = v_now + (p_lockout_seconds || ' seconds')::interval
        WHERE key = p_key;
    ELSE
        UPDATE public.rate_limit_entries
        SET count = v_entry.count
        WHERE key = p_key;
    END IF;
END;
$$;

-- ฟังก์ชันล้าง rate limit เมื่อล็อกอินสำเร็จ
CREATE OR REPLACE FUNCTION public.rate_limit_clear(p_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    DELETE FROM public.rate_limit_entries WHERE key = p_key;
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_is_locked(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_is_locked(text) TO authenticated;

REVOKE ALL ON FUNCTION public.rate_limit_record_failure(text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_record_failure(text, integer, integer, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.rate_limit_clear(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_clear(text) TO authenticated;