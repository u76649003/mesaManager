-- Allow public read for room-backgrounds bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'Public read room-backgrounds'
  ) THEN
    EXECUTE 'CREATE POLICY "Public read room-backgrounds" ON storage.objects FOR SELECT USING (bucket_id = ''room-backgrounds'')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'Auth upload room-backgrounds'
  ) THEN
    EXECUTE 'CREATE POLICY "Auth upload room-backgrounds" ON storage.objects FOR INSERT WITH CHECK (bucket_id = ''room-backgrounds'')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'Auth update room-backgrounds'
  ) THEN
    EXECUTE 'CREATE POLICY "Auth update room-backgrounds" ON storage.objects FOR UPDATE USING (bucket_id = ''room-backgrounds'')';
  END IF;
END $$;
