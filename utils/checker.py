from thefuzz import fuzz

def check_answer(guess: str, answer: str, alt_answers: list[str], threshold: float = 85.0) -> bool:
    """
    Check if the guess matches the answer or any alternative answers using fuzzy matching.
    
    Args:
        guess (str): The user's guess
        answer (str): The correct answer
        alt_answers (list[str]): List of alternative acceptable answers
        threshold (float): Minimum similarity score to consider a match (0-100)
    
    Returns:
        bool: True if the guess is close enough to any acceptable answer
    """
    # Normalize input
    guess = guess.lower().strip()
    answers = [answer.lower().strip()] + [alt.lower().strip() for alt in alt_answers]
    
    # Check each possible answer
    for possible_answer in answers:
        # Use token sort ratio to handle word order differences
        ratio = fuzz.token_sort_ratio(guess, possible_answer)
        if ratio >= threshold:
            return True
    
    return False 