import os
from typing import Dict, List, Optional
from datetime import datetime
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables from .env file in development
load_dotenv()

class Database:
    def __init__(self):
        """Initialize Supabase client with environment variables."""
        url: str = os.environ.get("SUPABASE_URL")
        key: str = os.environ.get("SUPABASE_KEY")
        
        if not url or not key:
            raise ValueError("Missing Supabase credentials. Please check your environment variables.")
        
        self.client: Client = create_client(url, key)
    
    def save_leaderboard_entry(self, entry: Dict) -> Dict:
        """
        Save a new leaderboard entry to Supabase.
        
        Args:
            entry (dict): The leaderboard entry containing name, solve_time, clues_used, etc.
            
        Returns:
            dict: The saved entry with its database ID
        """
        try:
            # Ensure the entry has all required fields
            required_fields = {'name', 'solveTime', 'cluesUsed', 'date'}
            if not all(field in entry for field in required_fields):
                raise ValueError(f"Missing required fields. Entry must contain: {required_fields}")
            
            # Convert the entry to match database schema
            db_entry = {
                'name': entry['name'],
                'solve_time': entry['solveTime'],
                'clues_used': entry['cluesUsed'],
                'date': entry['date'],
                'x_profile': entry.get('xProfile'),  # Optional field
                'timestamp': entry.get('timestamp', datetime.utcnow().isoformat() + "Z")
            }
            
            # Insert the entry into Supabase
            result = self.client.table('leaderboard').insert(db_entry).execute()
            
            if 'error' in result:
                raise Exception(f"Failed to save entry: {result['error']}")
                
            return result.data[0]
            
        except Exception as e:
            print(f"Error saving leaderboard entry: {str(e)}")
            raise
    
    def fetch_leaderboard(self, date: Optional[str] = None) -> List[Dict]:
        """
        Fetch the leaderboard entries for a specific date, sorted by solve time and clues used.
        
        Args:
            date (str, optional): The date to fetch entries for. Defaults to today.
            
        Returns:
            list: List of leaderboard entries
        """
        try:
            if not date:
                date = datetime.now().strftime('%Y-%m-%d')
            
            # Query Supabase with sorting and filtering
            result = self.client.table('leaderboard')\
                .select('*')\
                .eq('date', date)\
                .order('solve_time', desc=False)\
                .order('clues_used', desc=False)\
                .limit(100)\
                .execute()
            
            if 'error' in result:
                raise Exception(f"Failed to fetch leaderboard: {result['error']}")
            
            # Convert database format back to application format
            entries = []
            for entry in result.data:
                app_entry = {
                    'name': entry['name'],
                    'solveTime': entry['solve_time'],
                    'cluesUsed': entry['clues_used'],
                    'date': entry['date'],
                    'timestamp': entry['timestamp']
                }
                
                if entry.get('x_profile'):
                    app_entry['xProfile'] = entry['x_profile']
                
                entries.append(app_entry)
            
            return entries
            
        except Exception as e:
            print(f"Error fetching leaderboard: {str(e)}")
            raise

# Create a singleton instance
db = Database()

# Export functions for easier imports
save_leaderboard_entry = db.save_leaderboard_entry
fetch_leaderboard = db.fetch_leaderboard 