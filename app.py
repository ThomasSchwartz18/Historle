from flask import Flask, render_template, jsonify, request
import json
from datetime import datetime
import time
from utils.checker import check_answer

app = Flask(__name__)

# Global variable to store game start times for each session
game_sessions = {}

def load_daily_event():
    """Load and return the event for the current date."""
    with open('data/events.json', 'r') as f:
        events = json.load(f)
        
    today = datetime.now().strftime('%Y-%m-%d')
    for event in events:
        if event['date'] == today:
            return event
            
    # If no event for today, return the first event (for demo purposes)
    return events[0]

def load_leaderboard():
    """Load the leaderboard data from JSON file."""
    try:
        with open('data/leaderboard.json', 'r') as f:
            all_entries = json.load(f)
            
        # Filter for today's entries only
        today = datetime.now().strftime('%Y-%m-%d')
        return [entry for entry in all_entries if entry.get('date') == today]
    except (FileNotFoundError, json.JSONDecodeError):
        return []

def save_leaderboard(new_entries):
    """Save the leaderboard data to JSON file, preserving historical data."""
    try:
        with open('data/leaderboard.json', 'r') as f:
            all_entries = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        all_entries = []
    
    # Remove today's entries from the historical data
    today = datetime.now().strftime('%Y-%m-%d')
    historical_entries = [entry for entry in all_entries if entry.get('date') != today]
    
    # Add new entries for today
    all_entries = historical_entries + new_entries
    
    with open('data/leaderboard.json', 'w') as f:
        json.dump(all_entries, f, indent=2)

def time_to_seconds(time_str):
    """Convert HH:MM:SS.mmm format to total seconds for sorting."""
    hours, minutes, seconds = time_str.split(':')
    seconds, milliseconds = seconds.split('.')
    total_seconds = int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(milliseconds) / 1000
    return total_seconds

@app.route('/')
def index():
    """Render the main game page."""
    return render_template('index.html')

@app.route('/api/game/start', methods=['GET'])
def start_game():
    """Initialize the game with the first clue and start timing."""
    # Generate a unique session ID
    session_id = str(time.time())
    game_sessions[session_id] = {
        'start_time': time.perf_counter(),
        'clues_used': 0
    }
    
    event = load_daily_event()
    return jsonify({
        'sessionId': session_id,
        'clue': event['clues'][0],
        'total_clues': len(event['clues']),
        'year': event['year']
    })

@app.route('/api/game/check', methods=['POST'])
def check_guess():
    """Check if the guess is correct and update clues used."""
    data = request.get_json()
    guess = data.get('guess', '').strip()
    clue_index = data.get('clueIndex', 0)
    session_id = data.get('sessionId')
    
    if session_id not in game_sessions:
        return jsonify({'error': 'Invalid session'}), 400
    
    event = load_daily_event()
    game_sessions[session_id]['clues_used'] = clue_index + 1
    
    is_correct = check_answer(guess, event['answer'], event['alt_answers'])
    
    response = {
        'correct': is_correct,
        'clueIndex': clue_index
    }
    
    if is_correct:
        response['summary'] = event['summary']
        response['answer'] = event['answer']
    elif clue_index + 1 < len(event['clues']):
        response['nextClue'] = event['clues'][clue_index + 1]
    else:
        response['gameOver'] = True
        response['summary'] = event['summary']
        response['answer'] = event['answer']
    
    return jsonify(response)

@app.route('/api/game/finish', methods=['POST'])
def finish_game():
    """Record the game result in the leaderboard."""
    data = request.get_json()
    session_id = data.get('sessionId')
    player_name = data.get('name', 'Anonymous')
    
    if session_id not in game_sessions:
        return jsonify({'error': 'Invalid session'}), 400
    
    session = game_sessions[session_id]
    end_time = time.perf_counter()
    elapsed = end_time - session['start_time']
    
    # Compute time components
    hours = int(elapsed // 3600)
    minutes = int((elapsed % 3600) // 60)
    seconds = int(elapsed % 60)
    milliseconds = int((elapsed - int(elapsed)) * 1000)
    
    # Format elapsed time
    formatted_time = f"{hours:02}:{minutes:02}:{seconds:02}.{milliseconds:03}"
    
    # Create leaderboard entry
    today = datetime.now().strftime('%Y-%m-%d')
    leaderboard_entry = {
        "name": player_name,
        "solveTime": formatted_time,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "cluesUsed": session['clues_used'],
        "date": today
    }
    
    # Update leaderboard
    leaderboard = load_leaderboard()
    leaderboard.append(leaderboard_entry)
    
    # Sort leaderboard by solve time first, then by clues used
    leaderboard.sort(key=lambda x: (time_to_seconds(x['solveTime']), x['cluesUsed']))
    
    # Keep only top 100 entries for today
    leaderboard = leaderboard[:100]
    save_leaderboard(leaderboard)
    
    # Clean up session
    del game_sessions[session_id]
    
    return jsonify({
        "status": "success",
        "entry": leaderboard_entry,
        "rank": leaderboard.index(leaderboard_entry) + 1
    })

@app.route('/api/leaderboard', methods=['GET'])
def get_leaderboard():
    """Get the current leaderboard."""
    leaderboard = load_leaderboard()
    # Ensure leaderboard is sorted by time first, then clues
    leaderboard.sort(key=lambda x: (time_to_seconds(x['solveTime']), x['cluesUsed']))
    return jsonify(leaderboard)

if __name__ == '__main__':
    app.run(debug=True) 