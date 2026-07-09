import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

type DetectionResult = {
  inserted_count: number
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  })
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const cronSecret = Deno.env.get("FOLLOW_UP_CRON_SECRET")
  if (cronSecret && request.headers.get("x-cron-secret") !== cronSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase Edge Function credentials are not configured" }, 503)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { data, error } = await supabase.rpc("detect_follow_up_tasks_atomic")

  if (error) {
    console.error("Follow-up task detection failed", error.message)
    return jsonResponse({ error: "Unable to detect follow-up tasks" }, 503)
  }

  const result = Array.isArray(data) ? data[0] as DetectionResult | undefined : data as DetectionResult | null

  return jsonResponse({
    ok: true,
    inserted_count: result?.inserted_count ?? 0,
  })
})