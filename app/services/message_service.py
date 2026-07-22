from datetime import datetime
from app.supabase_client import get_supabase


class MessageService:

    @staticmethod
    def save_message(sender_id: int, receiver_id: int, content: str = None, reply_to: int = None, media: list = None):
        record = {
            "sender_id": sender_id,
            "receiver_id": receiver_id,
        }
        if content:
            record["content"] = content
        if reply_to:
            record["reply_to"] = reply_to
        data = get_supabase().table("messages").insert(record).execute()
        message = data.data[0] if data.data else None
        if message and media:
            media_records = [{**m, "message_id": message["id"]} for m in media]
            get_supabase().table("message_media").insert(media_records).execute()
            message["media"] = media
        if message and reply_to:
            reply_data = get_supabase().table("messages").select("id, content, sender_id").eq("id", reply_to).execute()
            if reply_data.data:
                rmsg = reply_data.data[0]
                user_data = get_supabase().table("users").select("id, username").eq("id", rmsg["sender_id"]).execute()
                if user_data.data:
                    rmsg["sender_username"] = user_data.data[0]["username"]
                media_data = get_supabase().table("message_media").select("*").eq("message_id", reply_to).execute()
                if media_data.data:
                    rmsg["media"] = media_data.data
                message["reply_to_message"] = rmsg
        return message

    @staticmethod
    def get_conversation(user_a_id: int, user_b_id: int, limit: int = 30, before_id: int = None):
        supabase = get_supabase()
        query = (
            supabase.table("messages")
            .select("*")
            .or_(
                f"and(sender_id.eq.{user_a_id},receiver_id.eq.{user_b_id}),"
                f"and(sender_id.eq.{user_b_id},receiver_id.eq.{user_a_id})"
            )
            .order("id", desc=True)
            .limit(limit)
        )
        if before_id:
            query = query.lt("id", before_id)
        data = query.execute()
        messages = list(reversed(data.data))
        existing_ids = {m["id"] for m in messages}

        # Collect all reply_to IDs and ensure those messages are included
        reply_ids = set()
        for m in messages:
            rid = m.get("reply_to")
            if rid and rid not in existing_ids:
                reply_ids.add(str(rid))

        # Fetch any missing replied-to messages that fell outside the limit
        extra_msgs = []
        if reply_ids:
            extra = (
                supabase.table("messages")
                .select("*")
                .in_("id", list(reply_ids))
                .execute()
            )
            for em in extra.data:
                if em["id"] not in existing_ids:
                    extra_msgs.append(em)
                    existing_ids.add(em["id"])

        # Merge extra messages into the main list (sorted by timestamp)
        if extra_msgs:
            messages.extend(extra_msgs)
            messages.sort(key=lambda m: m["timestamp"])

        # Now fetch reply_to_message data for messages that have reply_to
        all_reply_ids = [str(m["reply_to"]) for m in messages if m.get("reply_to")]
        if all_reply_ids:
            replies = (
                supabase.table("messages")
                .select("id, content, sender_id")
                .in_("id", all_reply_ids)
                .execute()
            )
            reply_map = {r["id"]: r for r in replies.data}
            sender_ids = list({r["sender_id"] for r in replies.data if r.get("sender_id")})
            if sender_ids:
                users = (
                    supabase.table("users")
                    .select("id, username")
                    .in_("id", [str(s) for s in sender_ids])
                    .execute()
                )
                user_map = {u["id"]: u["username"] for u in users.data}
                for r in replies.data:
                    r["sender_username"] = user_map.get(r["sender_id"], "Unknown")
            # Attach media to replied-to messages
            reply_media_data = supabase.table("message_media").select("*").in_("message_id", all_reply_ids).execute()
            reply_media_by_msg = {}
            for md in reply_media_data.data or []:
                reply_media_by_msg.setdefault(md["message_id"], []).append(md)
            for r in replies.data:
                if r["id"] in reply_media_by_msg:
                    r["media"] = reply_media_by_msg[r["id"]]
            for m in messages:
                rid = m.get("reply_to")
                if rid and rid in reply_map:
                    m["reply_to_message"] = reply_map[rid]

        # Attach media to messages
        msg_ids = [str(m["id"]) for m in messages]
        if msg_ids:
            media_data = get_supabase().table("message_media").select("*").in_("message_id", msg_ids).execute()
            media_by_msg = {}
            for md in media_data.data or []:
                mid = md["message_id"]
                media_by_msg.setdefault(mid, []).append(md)
            for m in messages:
                if m["id"] in media_by_msg:
                    m["media"] = media_by_msg[m["id"]]

        # Track which messages have replies pointing to them
        replied_ids = {m["reply_to"] for m in messages if m.get("reply_to")}
        for m in messages:
            if m["id"] in replied_ids:
                m["has_replies"] = True

        has_more = len(messages) == limit
        return {"messages": messages, "has_more": has_more}

    @staticmethod
    def get_unread_counts(user_id: int) -> dict:
        data = get_supabase().table("messages").select("sender_id, is_read").eq("receiver_id", user_id).execute()
        counts = {}
        for m in data.data or []:
            if not m.get("is_read"):
                sid = m["sender_id"]
                counts[sid] = counts.get(sid, 0) + 1
        return counts

    @staticmethod
    def mark_as_read(receiver_id: int, sender_id: int) -> None:
        get_supabase().table("messages").update({
            "is_read": True
        }).eq("receiver_id", receiver_id).eq("sender_id", sender_id).eq("is_read", False).execute()
