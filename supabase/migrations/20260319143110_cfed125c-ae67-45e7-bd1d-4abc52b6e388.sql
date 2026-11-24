-- Update iGet polling frequency from every 2 minutes to every 1 minute
SELECT cron.unschedule('poll-iget-orders');

SELECT cron.schedule(
  'poll-iget-orders',
  '* * * * *',
  $$
  SELECT net.http_post(
    url:='https://bpntlyplmitxiaounthf.supabase.co/functions/v1/poll-iget-orders',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwbnRseXBsbWl0eGlhb3VudGhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5OTg3MTQsImV4cCI6MjA4ODU3NDcxNH0.en6ActRrL5y9uV-GLw64gemQGpgywPVYpjt1Wfc3kgM"}'::jsonb,
    body:='{"time": "now"}'::jsonb
  ) AS request_id;
  $$
);