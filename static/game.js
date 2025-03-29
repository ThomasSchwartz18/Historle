document.addEventListener('DOMContentLoaded', () => {
    const gameState = {
        currentClueIndex: 0,
        totalClues: 4,
        gameOver: false,
        year: null,
        sessionId: null
    };

    const elements = {
        guessForm: document.getElementById('guess-form'),
        guessInput: document.getElementById('guess-input'),
        currentClue: document.getElementById('current-clue'),
        previousClues: document.getElementById('previous-clues'),
        guessesLeft: document.getElementById('guesses-left'),
        gameOver: document.getElementById('game-over'),
        resultHeader: document.getElementById('result-header'),
        correctAnswer: document.getElementById('correct-answer'),
        eventSummary: document.getElementById('event-summary'),
        shareButton: document.getElementById('share-button'),
        eventYear: document.getElementById('event-year'),
        eventDifficulty: document.getElementById('event-difficulty'),
        nameEntry: document.getElementById('name-entry'),
        playerName: document.getElementById('player-name'),
        submitScore: document.getElementById('submit-score'),
        leaderboardEntries: document.getElementById('leaderboard-entries')
    };

    // Initialize the game
    async function initGame() {
        try {
            const response = await fetch('/api/game/start');
            const data = await response.json();
            
            gameState.totalClues = data.total_clues;
            gameState.year = data.year;
            gameState.sessionId = data.sessionId;
            
            elements.currentClue.textContent = data.clue;
            elements.eventYear.textContent = data.year;
            elements.guessesLeft.textContent = gameState.totalClues;

            // Update difficulty display
            if (data.difficulty) {
                elements.eventDifficulty.textContent = `Difficulty: ${data.difficulty}`;
                elements.eventDifficulty.parentElement.setAttribute('data-difficulty', data.difficulty.toLowerCase());
            }
            
            elements.guessInput.focus();
            
            // Load initial leaderboard
            loadLeaderboard();
        } catch (error) {
            console.error('Failed to initialize game:', error);
            elements.currentClue.textContent = 'Failed to load game. Please refresh the page.';
        }
    }

    // Handle guess submission
    async function handleGuess(event) {
        event.preventDefault();
        
        if (gameState.gameOver) return;

        const guess = elements.guessInput.value.trim();
        if (!guess) return;

        try {
            const response = await fetch('/api/game/check', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    guess: guess,
                    clueIndex: gameState.currentClueIndex,
                    sessionId: gameState.sessionId
                })
            });

            const data = await response.json();
            processGuessResult(data, guess);
        } catch (error) {
            console.error('Failed to submit guess:', error);
        }

        elements.guessInput.value = '';
    }

    // Process the guess result
    function processGuessResult(data, guess) {
        if (data.correct) {
            showGameOver(true, data);
            elements.nameEntry.classList.remove('hidden');
        } else {
            if (data.nextClue) {
                // Move current clue to previous clues
                const clueElement = document.createElement('div');
                clueElement.className = 'clue';
                clueElement.textContent = elements.currentClue.textContent;
                elements.previousClues.insertBefore(clueElement, elements.previousClues.firstChild);

                // Show next clue
                elements.currentClue.textContent = data.nextClue;
                gameState.currentClueIndex++;
                elements.guessesLeft.textContent = gameState.totalClues - gameState.currentClueIndex;
            } else {
                showGameOver(false, data);
            }
        }
    }

    // Show game over screen
    function showGameOver(won, data) {
        gameState.gameOver = true;
        elements.gameOver.classList.remove('hidden');
        elements.guessForm.style.display = 'none';

        elements.resultHeader.textContent = won ? 'Congratulations!' : 'Game Over';
        elements.correctAnswer.textContent = `The correct answer was: ${data.answer}`;
        elements.eventSummary.textContent = data.summary;

        // Update share button
        elements.shareButton.addEventListener('click', () => shareResult(won));
    }

    // Submit score to leaderboard
    async function submitScore() {
        const playerName = elements.playerName.value.trim();
        const xUsername = document.getElementById('x-username').value.trim();
        if (!playerName) return;

        try {
            const response = await fetch('/api/game/finish', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: playerName,
                    x_username: xUsername,
                    sessionId: gameState.sessionId
                })
            });

            const data = await response.json();
            if (data.status === 'success') {
                elements.nameEntry.classList.add('hidden');
                loadLeaderboard();
            }
        } catch (error) {
            console.error('Failed to submit score:', error);
        }
    }

    // Load and display leaderboard
    async function loadLeaderboard() {
        try {
            const response = await fetch('/api/leaderboard');
            const leaderboard = await response.json();
            
            elements.leaderboardEntries.innerHTML = '';
            leaderboard.forEach((entry, index) => {
                const entryElement = document.createElement('div');
                entryElement.className = 'leaderboard-entry';
                let nameDisplay = entry.name;
                if (entry.xProfile) {
                    nameDisplay = `<a href="${entry.xProfile}" target="_blank" rel="noopener noreferrer">
                        ${entry.name}
                        <img src="/static/images/x-logo.png" alt="X Logo" class="x-logo">
                    </a>`;
                }
                entryElement.innerHTML = `
                    <span class="rank">${index + 1}</span>
                    <span class="name">${nameDisplay}</span>
                    <span class="time">${entry.solveTime}</span>
                    <span class="clues">${entry.cluesUsed}</span>
                `;
                elements.leaderboardEntries.appendChild(entryElement);
            });
        } catch (error) {
            console.error('Failed to load leaderboard:', error);
        }
    }

    // Share result
    function shareResult(won) {
        const emoji = won ? '🎉' : '😔';
        const guessCount = gameState.currentClueIndex + 1;
        const shareText = `Historle ${new Date().toLocaleDateString()}\n${emoji} ${won ? `Solved in ${guessCount}` : 'Failed after 4'} guesses!\nPlay at: [your-website-url]`;
        
        if (navigator.share) {
            navigator.share({
                text: shareText
            }).catch(console.error);
        } else {
            navigator.clipboard.writeText(shareText)
                .then(() => alert('Result copied to clipboard!'))
                .catch(console.error);
        }
    }

    // Event listeners
    elements.guessForm.addEventListener('submit', handleGuess);
    elements.guessInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleGuess(e);
        }
    });

    elements.submitScore.addEventListener('click', submitScore);
    elements.playerName.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitScore();
        }
    });

    // Add modal close functionality
    const modalClose = document.getElementById('modal-close');
    const gameOverModal = document.getElementById('game-over');

    modalClose.addEventListener('click', function() {
        gameOverModal.classList.add('hidden');
    });

    // Close modal when clicking overlay
    gameOverModal.addEventListener('click', function(e) {
        if (e.target === gameOverModal) {
            gameOverModal.classList.add('hidden');
        }
    });

    // Countdown timer functionality
    function updateCountdown() {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        
        const timeLeft = tomorrow - now;
        
        const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
        
        document.getElementById('countdown-hours').textContent = String(hours).padStart(2, '0');
        document.getElementById('countdown-minutes').textContent = String(minutes).padStart(2, '0');
        document.getElementById('countdown-seconds').textContent = String(seconds).padStart(2, '0');
    }

    // Update countdown every second
    updateCountdown();
    setInterval(updateCountdown, 1000);

    // Start the game
    initGame();
}); 