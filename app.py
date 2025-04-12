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
    today_str = date.today().strftime("%Y-%m-%d")
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
    today_str = date.today().strftime("%Y-%m-%d")
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
    today_str = date.today().strftime("%Y-%m-%d")
    try:
        result = supabase.table("leaderboard") \
                         .select("*") \
                         .eq("date", today_str) \
                         .lte("clues_used", 5) \
                         .order("solve_time", desc=False) \
                         .order("clues_used", desc=False) \
                         .limit(10) \
                         .execute()
        leaderboard_data = result.data
        return jsonify(leaderboard_data)
    except Exception as e:
        print("Leaderboard fetch error:", e)
        return jsonify({"error": "Failed to fetch leaderboard data"}), 500

@app.route("/api/score", methods=["POST"])
def api_score():
    """
    API endpoint to submit a player's score.
    Expects a JSON payload with name, x_username (optional), time, and clues.
    """
    today_str = date.today().strftime("%Y-%m-%d")
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid data"}), 400
    name = data.get("name", "").strip()
    x_username = data.get("x_username", "").strip()
    time_taken = data.get("time")
    clues_used = data.get("clues")
    if not is_valid_name(name) or not is_valid_x_username(x_username) or not isinstance(time_taken, str) or not isinstance(clues_used, int):
        return jsonify({"error": "Invalid or unsafe data"}), 400
    if len(name) > 20:
        name = name[:20]
    if len(x_username) > 30:
        x_username = x_username[:30]
    x_profile = f"https://x.com/{x_username}" if x_username else ""
    score_entry = {
        "name": name,
        "x_profile": x_profile,
        "solve_time": time_taken,
        "clues_used": clues_used,
        "date": today_str,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    try:
        result = supabase.table("leaderboard").insert(score_entry).execute()
        return jsonify({"success": True, "entry": result.data}), 201
    except Exception as e:
        print("Score submission error:", e)
        return jsonify({"error": "Failed to submit score"}), 500

@app.route("/api/submit_score", methods=["POST"])
def submit_score():
    """
    API endpoint to submit a player's score.
    Also updates the user's win/loss and streak statistics if registered.
    """
    data = request.get_json()
    username = data.get("username")

    # Ensure the session matches the provided username.
    if "username" not in session or session.get("username") != username:
        return jsonify({
            "success": True,
            "message": "Score submission skipped for non-registered user."
        })
    solve_time = data.get("solve_time")
    clues_used = data.get("clues_used")
    event_date = data.get("event_date")
    win = data.get("win", False)
    if not username or not solve_time or clues_used is None or not event_date:
        return jsonify({"error": "Missing data"}), 400

    # Record the score in the leaderboard.
    score_entry = {
        "name": username,
        "solve_time": solve_time,
        "clues_used": clues_used,
        "date": event_date,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    if "x_profile" in data and data["x_profile"]:
        score_entry["x_profile"] = data["x_profile"]
    try:
        supabase.table("leaderboard").insert(score_entry).execute()
    except Exception as e:
        print("Leaderboard insert error:", str(e))
        return jsonify({"error": "Failed to record leaderboard entry."}), 500

    # Update user statistics.
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
        if win:
            total_wins += 1
            last_win = user_data.get("last_win_date")
            if last_win:
                last_win_date = datetime.fromisoformat(last_win).date()
                if (today - last_win_date).days == 1:
                    current_streak += 1
                elif (today - last_win_date).days != 0:
                    current_streak = 1
            else:
                current_streak = 1
            if current_streak > longest_win_streak:
                longest_win_streak = current_streak
            new_last_win_date = today.isoformat()
        else:
            total_losses += 1
            current_streak = 0
            new_last_win_date = user_data.get("last_win_date")
        # Updated to also record the participation date as last_played_date.
        supabase.table("users").update({
            "streak": current_streak,
            "days_played": days_played,
            "total_wins": total_wins,
            "total_losses": total_losses,
            "longest_win_streak": longest_win_streak,
            "last_win_date": new_last_win_date,
            "last_played_date": today.isoformat()
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
        print("User stats update error:", str(e))
        return jsonify({"error": "Failed to update user stats."}), 500

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

    today_str = date.today().strftime("%Y-%m-%d")
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

if __name__ == "__main__":
    # In production, debug should be disabled for security reasons.
    app.run(host='0.0.0.0', port=5002, debug=False)
