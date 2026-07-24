from app.supabase_client import get_supabase


class MessageService:
    @staticmethod
    def save_message(sender_id: int, receiver_id: int, content: str = None):
        record = {
            "sender_id": sender_id,
            "receiver_id": receiver_id,
        }
        if content:
            record["content"] = content
        data = get_supabase().table("messages").insert(record).execute()
        return data.data[0] if data.data else None

    @staticmethod
    def get_conversation(
        user_a_id: int, user_b_id: int, limit: int = 30, before_id: int = None
    ):
        """Fetch paginated bidirectional conversation with media."""
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
        {m["id"] for m in messages}

        # Attach media to messages
        msg_ids = [str(m["id"]) for m in messages]
        if msg_ids:
            media_data = (
                get_supabase()
                .table("message_media")
                .select("*")
                .in_("message_id", msg_ids)
                .execute()
            )
            media_by_msg = {}
            for md in media_data.data or []:
                mid = md["message_id"]
                media_by_msg.setdefault(mid, []).append(md)
            for m in messages:
                if m["id"] in media_by_msg:
                    m["media"] = media_by_msg[m["id"]]

        has_more = len(messages) == limit
        return {"messages": messages, "has_more": has_more}

    @staticmethod
    def get_unread_counts(user_id: int) -> dict:
        """Count unread messages grouped by sender_id."""
        data = (
            get_supabase()
            .table("messages")
            .select("sender_id, is_read")
            .eq("receiver_id", user_id)
            .execute()
        )
        counts = {}
        for m in data.data or []:
            if not m.get("is_read"):
                sid = m["sender_id"]
                counts[sid] = counts.get(sid, 0) + 1
        return counts

    @staticmethod
    def mark_as_read(receiver_id: int, sender_id: int) -> None:
        """Set is_read=True for all unread messages from sender to receiver."""
        get_supabase().table("messages").update({"is_read": True}).eq(
            "receiver_id", receiver_id
        ).eq("sender_id", sender_id).eq("is_read", False).execute()
