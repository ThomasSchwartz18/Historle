import os
from datetime import datetime, date, timezone
from flask import Flask, render_template, jsonify, request, abort
from flask_cors import CORS  # For secure cross-origin requests if needed
import re
from better_profanity import profanity

# Import the Supabase client to securely interact with our database.
from supabase import create_client, Client

app = Flask(__name__)
CORS(app)

# Load Supabase credentials from environment variables (set these securely on Heroku)
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise Exception("Supabase credentials not set in environment variables")

# Create a secure connection to the Supabase backend
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

profanity.load_censor_words()

def is_valid_name(name: str) -> bool:
    """Name shown on leaderboard. Must be safe, short, clean."""
    return (
        1 <= len(name) <= 20 and
        re.match(r"^[a-zA-Z0-9 _.\-]+$", name) and
        not profanity.contains_profanity(name)
    )

def is_valid_x_username(x_username: str) -> bool:
    """Username is optional. Allows only Twitter-safe handles."""
    return (
        len(x_username) <= 30 and
        (x_username == "" or re.match(r"^[a-zA-Z0-9_]+$", x_username))
    )

# ---------------------------
# Utility Function: Fetch Today's Event from Supabase
# ---------------------------
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

# ---------------------------
# Route Definitions
# ---------------------------
@app.route("/")
def index():
    """
    Serves the main HTML page (templates/index.html). This page loads the game interface
    and references our static assets (CSS and game.js) which handle front-end functionality.
    """
    return render_template("index.html")

@app.route("/api/event", methods=["GET"])
def api_event():
    """
    API endpoint to retrieve today's historical event.
    Returns only the necessary details: year, difficulty, clues, summary, date,
    and (for game functionality) the answer and alternate answers.
    """
    event = get_event_for_today()
    if not event:
        return jsonify({"error": "No event found for today"}), 404

    response = {
        "year": event.get("year"),
        "difficulty": event.get("difficulty"),
        "clues": event.get("clues"),
        "summary": event.get("summary"),
        "date": event.get("date"),
        "answer": event.get("answer"),
        "alt_answers": event.get("alt_answers")
    }
    return jsonify(response)

@app.route("/api/leaderboard", methods=["GET"])
def api_leaderboard():
    """
    API endpoint to retrieve the top 10 leaderboard entries for today.
    Sorting is performed by solve_time (ascending) and by clues_used (ascending) in case of ties.
    """
    today_str = date.today().strftime("%Y-%m-%d")
    try:
        result = supabase.table("leaderboard") \
                         .select("*") \
                         .eq("date", today_str) \
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
    Expects a JSON payload with 'name', 'x_username' (optional), 'time', and 'clues'.
    Implements input validation and sanitization to protect against malicious data.
    
    Note: The incoming JSON keys are remapped to the expected database column names:
          - "time" -> "solve_time"
          - "clues" -> "clues_used"
          - "x_username" -> "x_profile"
    """
    today_str = date.today().strftime("%Y-%m-%d")
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid data"}), 400

    # Extract and sanitize input values
    name = data.get("name", "").strip()
    x_username = data.get("x_username", "").strip()
    time_taken = data.get("time")
    clues_used = data.get("clues")
    
    if not is_valid_name(name) or not is_valid_x_username(x_username) or not isinstance(time_taken, str) or not isinstance(clues_used, int):
        return jsonify({"error": "Invalid or unsafe data"}), 400

    # Limit input lengths for security
    if len(name) > 20:
        name = name[:20]
    if len(x_username) > 30:
        x_username = x_username[:30]

    # Prepend "https://x.com/" to the inputted x_username if provided
    x_profile = f"https://x.com/{x_username}" if x_username else ""

    # Map incoming keys to the database schema
    score_entry = {
        "name": name,
        "x_profile": x_profile,          # Remapped key with URL prepended
        "solve_time": time_taken,         # Remapped key
        "clues_used": clues_used,         # Remapped key
        "date": today_str,
        "timestamp": datetime.now(timezone.utc).isoformat()  # Use timezone-aware UTC datetime
    }

    try:
        result = supabase.table("leaderboard").insert(score_entry).execute()
        return jsonify({"success": True, "entry": result.data}), 201
    except Exception as e:
        print("Score submission error:", e)
        return jsonify({"error": "Failed to submit score"}), 500

# ---------------------------
# Main Application Entry Point
# ---------------------------
if __name__ == "__main__":
    # In production, debug should be disabled for security reasons.
    app.run(host='0.0.0.0', port=5001, debug=True) 
