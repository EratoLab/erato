-- Revert erato:0020_add_share_links_table from pg

BEGIN;

DROP TABLE public.share_links;

COMMIT;
