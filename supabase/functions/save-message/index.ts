import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  const { sender_id, receiver_id, content, reply_to, media } = await req.json()

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  )

  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      sender_id,
      receiver_id,
      content: content || null,
      reply_to: reply_to || null,
    })
    .select()
    .single()

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  const mediaRecords: Record<string, unknown>[] = []
  for (const m of media || []) {
    if (!m.data) continue
    try {
      const base64 = m.data.split(",")[1] || m.data
      const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const ext = (m.file_name || "image.jpg").split(".").pop() || "jpg"
      const filePath = `${sender_id}/${Date.now()}_${crypto.randomUUID()}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from("chat_media")
        .upload(filePath, raw, {
          contentType: m.file_type === "image" ? "image/jpeg" : m.file_type || "image/jpeg",
          upsert: false,
        })

      if (uploadError) {
        console.error("Upload error:", uploadError.message)
        continue
      }

      mediaRecords.push({
        message_id: message.id,
        file_path: filePath,
        file_type: m.file_type || "image",
        file_name: m.file_name || "",
        file_size: m.file_size || 0,
      })
    } catch (err) {
      console.error("Media error:", err)
    }
  }

  if (mediaRecords.length) {
    const { error: insertError } = await supabase
      .from("message_media")
      .insert(mediaRecords)

    if (insertError) {
      console.error("Insert media error:", insertError.message)
    }
  }

  return new Response(JSON.stringify({
    id: message.id,
    sender_id: message.sender_id,
    receiver_id: message.receiver_id,
    content: message.content,
    reply_to: message.reply_to,
    timestamp: message.timestamp,
    media: mediaRecords,
  }), {
    headers: { "Content-Type": "application/json" },
  })
})
