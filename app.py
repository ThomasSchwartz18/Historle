import os
from datetime import datetime, date, timezone, timedelta
from flask import Flask, render_template, jsonify, request, session, redirect, url_for
import re
from better_profanity import profanity
from supabase import create_client, Client
from werkzeug.security import generate_password_hash, check_password_hash
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import pytz

# Initialize Flask app and set a permanent session lifetime (30 days)
app = Flask(__name__)
# Set the fixed secret key from your environment variables
app.secret_key = os.environ.get("SECRET_KEY")
if not app.secret_key:
    raise Exception("A fixed SECRET_KEY must be set in the environment!")
app.permanent_session_lifetime = timedelta(days=30)
CORS(app, supports_credentials=True)

limiter = Limiter(get_remote_address, app=app, default_limits=[])

# Load Supabase credentials from environment variables
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise Exception("Supabase credentials not set in environment variables")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

profanity.load_censor_words()

def is_valid_name(name: str) -> bool:
    """Name shown on leaderboard. Must be safe, short, and clean."""
    return (
        1 <= len(name) <= 20 and
        re.match(r"^[a-zA-Z0-9 _.\-]+$", name) and
        not profanity.contains_profanity(name)
    )

def is_valid_x_username(x_username: str) -> bool:
    """Username (for X) is optional; allows only Twitter-safe handles."""
    return (
        len(x_username) <= 30 and
        (x_username == "" or re.match(r"^[a-zA-Z0-9_]+$", x_username))
    )

def get_event_for_today():
    """
    Query the Supabase daily_events table for the event matching today's date.
    Converts 'alt_answers' and 'clues' from semicolon-separated strings into lists.
    """
    today_str = get_current_game_date()
    try:
        result = supabase.table("daily_events") \
                         .select("*") \
                         .eq("date", today_str) \
                         .single() \
                         .execute()
        event = result.data
        if not event:
            return None
        # Process semicolon-separated fields into lists
        if "alt_answers" in event and isinstance(event["alt_answers"], str):
            event["alt_answers"] = [a.strip() for a in event["alt_answers"].split(";") if a.strip()]
        if "clues" in event and isinstance(event["clues"], str):
            event["clues"] = [c.strip() for c in event["clues"].split(";") if c.strip()]
        return event
    except Exception as e:
        print("Error fetching event from Supabase:", e)
        return None

# Date for current game
def get_current_game_date():
    # Use 'America/New_York' to properly account for Eastern Time and DST.
    tz = pytz.timezone("America/New_York")
    now = datetime.now(tz)
    # Define the 8pm cutoff
    cutoff = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if now < cutoff:
        # If before 8pm, the game day is still yesterday's event.
        game_date = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    else:
        game_date = now.strftime("%Y-%m-%d")
    return game_date

@app.route("/")
def index():
    """Serves the main HTML page."""
    return render_template("index.html")

@app.route("/api/event", methods=["GET"])
def api_event():
    """API endpoint to retrieve today's historical event without sensitive answer data."""
    event = get_event_for_today()
    if not event:
        return jsonify({"error": "No event found for today"}), 404
    # Only return clues and non-sensitive data
    response = {
        "year": event.get("year"),
        "difficulty": event.get("difficulty"),
        "clues": event.get("clues"),
        "summary": "",  # Hide summary until the game is complete
        "date": event.get("date"),
        "category": event.get("category")
    }
    return jsonify(response)

@app.route("/api/me", methods=["GET"])
def me():
    if "username" in session:
        return jsonify({"username": session.get("username")})
    else:
        return jsonify({"username": None}), 401
    
@app.route("/api/user_stats", methods=["GET"])
def user_stats():
    if "username" in session:
        result = supabase.table("users").select("*").eq("username", session.get("username")).single().execute()
        user_data = result.data
        if user_data:
            return jsonify({
                "streak": user_data.get("streak", 0)
            })
    return jsonify({"error": "Not authenticated"}), 401

@app.route("/api/reveal_answer", methods=["POST"])
def reveal_answer():
    """
    Secure endpoint to reveal the answer, alt_answers, and summary.
    Ensures that only today's event can be revealed.
    """
    data = request.get_json()
    event_date = data.get("event_date")
    if not event_date:
        return jsonify({"error": "Missing event date"}), 400
    today_str = get_current_game_date()
    if event_date != today_str:
        return jsonify({"error": "Invalid date"}), 403
    event = get_event_for_today()
    if not event:
        return jsonify({"error": "No event found for today"}), 404
    return jsonify({
        "answer": event.get("answer"),
        "alt_answers": event.get("alt_answers", []),
        "summary": event.get("summary")
    })

@app.route("/api/guess", methods=["POST"])
def check_guess():
    """
    Secure endpoint to validate a player's guess.
    The guess is compared against the correct answer and alternative answers.
    """
    data = request.get_json()
    guess = data.get("guess", "").strip().lower()
    event_date = data.get("event_date")
    if not guess or not event_date:
        return jsonify({"error": "Invalid guess data"}), 400
    event = get_event_for_today()
    if not event or event.get("date") != event_date:
        return jsonify({"error": "Event mismatch"}), 403
    correct = event.get("answer", "").strip().lower()
    alt_answers = event.get("alt_answers", [])
    alt_answers = [a.strip().lower() for a in alt_answers] if alt_answers else []
    if guess == correct or guess in alt_answers:
        return jsonify({"correct": True})
    return jsonify({"correct": False})

@app.route("/api/leaderboard", methods=["GET"])
def api_leaderboard():
    """API endpoint to retrieve the top 10 leaderboard entries for today."""
    today_str = get_current_game_date()
    try:
        result = supabase.table("leaderboard") \
                         .select("*") \
                         .eq("date", today_str) \
                         .lte("clues_used", 5) \
                         .order("solve_time", desc=False) \
                         .order("clues_used", desc=False) \
                         .limit(10) \
                         .execute()
        leaderboard_data = result.data or []
        # For each leaderboard entry, lookup the user's x_id from the users table.
        for entry in leaderboard_data:
            user_result = supabase.table("users") \
                                  .select("x_id") \
                                  .eq("username", entry["name"]) \
                                  .single() \
                                  .execute()
            user_info = user_result.data
            entry["x_id"] = user_info.get("x_id") if (user_info and user_info.get("x_id")) else None
        return jsonify(leaderboard_data)
    except Exception as e:
        print("Leaderboard fetch error:", e)
        return jsonify({"error": "Failed to fetch leaderboard data"}), 500

@app.route("/api/submit_score", methods=["POST"])
def submit_score():
    data = request.get_json()
    username = data.get("username")
    # Only registered users (i.e. whose session matches the provided username) can submit scores.
    if "username" not in session or session.get("username") != username:
        return jsonify({
            "success": True,
            "message": "Score submission skipped for non-registered user."
        })

    # Read required fields
    solve_time = data.get("solve_time")
    clues_used = data.get("clues_used")
    event_date = data.get("event_date")
    win = data.get("win", False)
    if not username or not solve_time or clues_used is None or not event_date:
        return jsonify({"error": "Missing data"}), 400

    # Build our score entry
    score_entry = {
        "name": username,
        "solve_time": solve_time,
        "clues_used": clues_used,
        "date": event_date,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

    # Retrieve x_id either from the request or the user record.
    # if "x_id" in data and data["x_id"].strip():
    #     score_entry["x_id"] = data["x_id"].strip()
    # else:
    #     result = supabase.table("users").select("x_id").eq("username", username).single().execute()
    #     user_info = result.data
    #     if user_info and user_info.get("x_id"):
    #         score_entry["x_id"] = user_info.get("x_id")

    try:
        supabase.table("leaderboard").insert(score_entry).execute()
    except Exception as e:
        print("Leaderboard insert error:", str(e))
        return jsonify({"error": "Failed to record leaderboard entry."}), 500

    # Update the user's statistics.
    try:
        result = supabase.table("users").select("*").eq("username", username).single().execute()
        user_data = result.data
        if not user_data:
            return jsonify({"error": "User not found."}), 404

        days_played = user_data.get("days_played") or 0
        total_wins = user_data.get("total_wins") or 0
        total_losses = user_data.get("total_losses") or 0
        current_streak = user_data.get("streak") or 0
        longest_win_streak = user_data.get("longest_win_streak") or 0

        today = datetime.strptime(event_date, "%Y-%m-%d").date()
        days_played += 1

        current_game_day = get_current_game_date()  # Using your game's cutoff logic.
        current_game_date_obj = datetime.strptime(current_game_day, "%Y-%m-%d").date()
        if win:
            total_wins += 1
            last_win = user_data.get("last_win_date")
            if last_win:
                last_win_date = datetime.fromisoformat(last_win).date()
                day_difference = (current_game_date_obj - last_win_date).days
                if day_difference == 1:
                    current_streak += 1
                elif day_difference > 1:
                    current_streak = 1
                # day_difference == 0 means same day; no update.
            else:
                current_streak = 1

            if current_streak > longest_win_streak:
                longest_win_streak = current_streak
            new_last_win_date = current_game_day
        else:
            total_losses += 1
            current_streak = 0
            new_last_win_date = user_data.get("last_win_date")

        # Update the user's statistics.
        supabase.table("users").update({
            "streak": current_streak,
            "days_played": days_played,
            "total_wins": total_wins,
            "total_losses": total_losses,
            "longest_win_streak": longest_win_streak,
            "last_win_date": new_last_win_date,
            "last_played_date": current_game_day
        }).eq("username", username).execute()

        return jsonify({
            "success": True,
            "streak": current_streak,
            "days_played": days_played,
            "total_wins": total_wins,
            "total_losses": total_losses,
            "longest_win_streak": longest_win_streak
        })
    except Exception as e:
        error_message = str(e)
        print("Leaderboard insert error:", error_message)
        return jsonify({"error": f"Failed to record leaderboard entry. Error: {error_message}"}), 500

@app.route("/api/already_played", methods=["POST"])
def already_played():
    """
    New endpoint to check if a registered user has already played today's game.
    Returns {"already_played": True} if the user's last_played_date matches today's date.
    """
    data = request.get_json()
    username = data.get("username")
    if not username:
        return jsonify({"error": "Missing username"}), 400

    result = supabase.table("users").select("last_played_date").eq("username", username).single().execute()
    user = result.data
    if not user:
        return jsonify({"error": "User not found"}), 404

    today_str = get_current_game_date()
    already_played = (user.get("last_played_date") == today_str)
    return jsonify({"already_played": already_played})

@limiter.limit("2 per hour")
@app.route("/api/register", methods=["POST"])
def register():
    """
    API endpoint to register a new user.
    Immediately logs in the user upon successful registration.
    """
    data = request.get_json()
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    x_id = data.get("x_id", "").strip()
    if not username or not password:
        return jsonify({"error": "Username and password required."}), 400
    result = supabase.table("users").select("username").eq("username", username).execute()
    if result.data:
        return jsonify({"error": "Username already exists."}), 409
    hashed_pw = generate_password_hash(password)
    new_user = {
        "username": username,
        "password": hashed_pw,
        "x_id": x_id,
        "streak": 0,
        "last_win_date": None,
        "days_played": 0,
        "total_wins": 0,
        "total_losses": 0,
        "longest_win_streak": 0,
        "created_at": datetime.utcnow().isoformat()
    }
    try:
        supabase.table("users").insert(new_user).execute()
        session['username'] = username
        session.permanent = True
        return jsonify({
            "success": True, 
            "username": username,
            "streak": 0,
            "x_id": x_id
        })
    except Exception as e:
        print("Registration failed:", str(e))
        return jsonify({"error": "Failed to register."}), 500

@app.route("/api/login", methods=["POST"])
def login():
    """
    API endpoint to log in an existing user.
    Sets the session to be permanent so the user remains logged in.
    """
    data = request.get_json()
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    result = supabase.table("users").select("*").eq("username", username).single().execute()
    user = result.data
    if not user:
        return jsonify({"error": "User not found."}), 404
    if not check_password_hash(user["password"], password):
        return jsonify({"error": "Incorrect password."}), 401
    session['username'] = user["username"]
    session.permanent = True
    return jsonify({
        "success": True,
        "username": user["username"],
        "streak": user.get("streak", 0),
        "x_id": user.get("x_id", None)
    })

@app.route("/logout")
def logout():
    """Clears the session and logs the user out."""
    session.clear()
    return redirect(url_for('index'))

# Track all user stats
@app.route("/api/user_full_stats", methods=["GET"])
def user_full_stats():
    if "username" in session:
        result = supabase.table("users") \
                         .select("*") \
                         .eq("username", session.get("username")) \
                         .single() \
                         .execute()
        user_data = result.data
        if user_data:
            days_played = user_data.get("days_played") or 0
            total_wins = user_data.get("total_wins") or 0
            win_percentage = 0
            if days_played > 0:
                win_percentage = round((total_wins / days_played) * 100, 2)
            return jsonify({
                "streak": user_data.get("streak", 0),
                "total_wins": total_wins,
                "days_played": days_played,
                "win_percentage": win_percentage,
                "longest_win_streak": user_data.get("longest_win_streak", 0)
            })
    return jsonify({"error": "Not authenticated"}), 401

# Route for the top streak leaders
@app.route("/api/streak_leaderboard", methods=["GET"])
def streak_leaderboard():
    """
    API endpoint to retrieve the top 5 users with the highest current streaks.
    This queries the users table and sorts by the streak column in descending order.
    """
    try:
        result = supabase.table("users") \
                         .select("username, streak, x_id") \
                         .order("streak", desc=True) \
                         .limit(5) \
                         .execute()
        streak_data = result.data
        return jsonify(streak_data)
    except Exception as e:
        print("Error fetching streak leaderboard:", e)
        return jsonify({"error": "Failed to fetch streak leaderboard"}), 500

if __name__ == "__main__":
    # In production, debug should be disabled for security reasons.
    app.run(host='0.0.0.0', port=5002, debug=False)
