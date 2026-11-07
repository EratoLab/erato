-- Deploy erato:0068_add_user_time_zone_and_language to pg
-- requires: 0067_add_teams_nudge_opt_out

BEGIN;

-- What the user's client last reported (Teams `clientInfo`, the web app's
-- browser zone and UI language). Times the user enters without a zone, such
-- as a reminder for "Friday 10:00", resolve in `time_zone` (an IANA name);
-- messages Erato sends later use `language` (a BCP 47 tag).
ALTER TABLE public.user_preferences
    ADD COLUMN time_zone text,
    ADD COLUMN language text;

COMMIT;
