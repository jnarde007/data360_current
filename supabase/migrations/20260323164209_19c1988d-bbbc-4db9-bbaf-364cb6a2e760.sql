-- Allow service_role to delete notifications (for cleanup function)
CREATE POLICY "Service role deletes notifications"
ON public.notifications
FOR DELETE
TO public
USING (auth.role() = 'service_role'::text);