import { supabase } from '@/integrations/supabase/client';

/**
 * Invoke an admin edge function with auth provided in both the Authorization
 * header and request body so protected admin functions continue to work across
 * relay verify_jwt modes.
 */
export async function invokeAdminFunction(
  functionName: string,
  body: Record<string, unknown>
): Promise<{ data: any; error: any }> {
  let session = (await supabase.auth.getSession()).data.session;

  if (session?.expires_at && session.expires_at * 1000 <= Date.now() + 60_000) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshed.session) {
      return {
        data: null,
        error: new Error('Your admin session expired. Please sign in again.'),
      };
    }
    session = refreshed.session;
  }

  const accessToken = session?.access_token;

  if (!accessToken) {
    return {
      data: null,
      error: new Error('No active admin session. Please sign in again.'),
    };
  }

  const result = await supabase.functions.invoke(functionName, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: { ...body, access_token: accessToken },
  });

  if (!result.error) {
    return result;
  }

  const context = (result.error as { context?: Response }).context;
  if (context) {
    try {
      const rawBody = await context.text();
      let message = result.error.message;

      if (rawBody) {
        try {
          const parsed = JSON.parse(rawBody) as { error?: string; message?: string };
          message = parsed.error || parsed.message || message;
        } catch {
          message = rawBody;
        }
      }

      const normalizedError = new Error(message);
      (normalizedError as Error & { status?: number }).status = context.status;
      return { data: result.data, error: normalizedError };
    } catch {
      return result;
    }
  }

  return result;
}
