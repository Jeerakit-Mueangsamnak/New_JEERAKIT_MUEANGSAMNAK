-- Shop images in Storage instead of inside database rows (owner 2026-11-20, egress list items 7–10).
--
-- Public bucket shop-images holds the shop logo, the pictures inside document forms and profile pictures.
-- The database keeps only each file's address (store_settings.logo_url, document_templates.template_schema,
-- profiles.avatar_url). File names are the SHA-256 of the picture, so a file never changes: browsers and the
-- CDN keep it, and the same picture saved twice is one file.
--
--   logo/<sha256>.<ext>              shop logo(s)          upload: OWNER
--   forms/<sha256>.<ext>             form page pictures     upload: members with the documents menu
--   avatars/<user id>/<sha256>.<ext> profile pictures       upload / remove: that user only
--
-- Nobody overwrites a file (no UPDATE policy). Only a user's own profile pictures can be removed
-- (removing the picture from the profile also takes the file away).
-- Skipped where the Storage schema does not exist (plain Postgres test container).

DO $storage$
BEGIN
    IF to_regclass('storage.buckets') IS NULL THEN
        RAISE NOTICE 'storage schema not present: shop-images bucket skipped';
        RETURN;
    END IF;

    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('shop-images', 'shop-images', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
    ON CONFLICT (id) DO NOTHING;

    DROP POLICY IF EXISTS shop_images_logo_insert ON storage.objects;
    CREATE POLICY shop_images_logo_insert ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'shop-images'
                    AND (storage.foldername(name))[1] = 'logo'
                    AND public.is_owner());

    DROP POLICY IF EXISTS shop_images_forms_insert ON storage.objects;
    CREATE POLICY shop_images_forms_insert ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'shop-images'
                    AND (storage.foldername(name))[1] = 'forms'
                    AND public.has_menu('documents'));

    DROP POLICY IF EXISTS shop_images_avatar_insert ON storage.objects;
    CREATE POLICY shop_images_avatar_insert ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'shop-images'
                    AND (storage.foldername(name))[1] = 'avatars'
                    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
                    AND public.is_active_member());

    -- Removing a file needs it to be visible to the remover as well.
    DROP POLICY IF EXISTS shop_images_avatar_select ON storage.objects;
    CREATE POLICY shop_images_avatar_select ON storage.objects
        FOR SELECT TO authenticated
        USING (bucket_id = 'shop-images'
               AND (storage.foldername(name))[1] = 'avatars'
               AND (storage.foldername(name))[2] = (SELECT auth.uid())::text);

    DROP POLICY IF EXISTS shop_images_avatar_delete ON storage.objects;
    CREATE POLICY shop_images_avatar_delete ON storage.objects
        FOR DELETE TO authenticated
        USING (bucket_id = 'shop-images'
               AND (storage.foldername(name))[1] = 'avatars'
               AND (storage.foldername(name))[2] = (SELECT auth.uid())::text);
END
$storage$;
