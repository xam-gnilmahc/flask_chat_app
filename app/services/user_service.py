from app.supabase_client import get_supabase


class UserService:

    @staticmethod
    def get_all_users():
        data = get_supabase().table("users").select("*").execute()
        return data.data

    @staticmethod
    def get_by_id(user_id: int):
        data = get_supabase().table("users").select("*").eq("id", user_id).execute()
        return data.data[0] if data.data else None

    @staticmethod
    def get_by_username(username: str):
        data = get_supabase().table("users").select("*").eq("username", username).execute()
        return data.data[0] if data.data else None

    @staticmethod
    def get_by_email(email: str):
        data = get_supabase().table("users").select("*").eq("email", email).execute()
        return data.data[0] if data.data else None

    @staticmethod
    def list_users_with_status(current_user_id: int, online_user_ids: set):
        data = get_supabase().table("users").select("*").neq("id", current_user_id).execute()
        result = []
        for u in data.data:
            u["is_online"] = u["id"] in online_user_ids
            result.append(u)
        return result

    @staticmethod
    def create_user(username: str, email: str, password_hash: str):
        data = get_supabase().table("users").insert({
            "username": username,
            "email": email,
            "password_hash": password_hash,
            "token_version": 0,
        }).execute()
        return data.data[0] if data.data else None

    @staticmethod
    def update_profile_pic(user_id: int, filename: str):
        get_supabase().table("users").update({"profile_pic": filename}).eq("id", user_id).execute()

    @staticmethod
    def increment_token_version(user_id: int):
        user = UserService.get_by_id(user_id)
        if not user:
            return
        new_version = (user.get("token_version") or 0) + 1
        get_supabase().table("users").update({"token_version": new_version}).eq("id", user_id).execute()
        return new_version
