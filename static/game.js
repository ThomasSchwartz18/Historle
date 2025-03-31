document.addEventListener('DOMContentLoaded', () => {
    // Global game state variables
    let currentEvent = null;
    let currentClueIndex = 0;
    let remainingGuesses = 5;
    let correctAnswer = "";
    let altAnswers = []; // Array of alternate valid answers
    let startTime = Date.now();

    // DOM elements for updating UI
    const currentClueEl = document.getElementById("current-clue");
    const previousCluesEl = document.getElementById("previous-clues");
    const guessesLeftEl = document.getElementById("guesses-left");
    const guessForm = document.getElementById("guess-form");
    const guessInput = document.getElementById("guess-input");
    const gameOverModal = document.getElementById("game-over");
    const modalCloseBtn = document.getElementById("modal-close");
    const resultHeaderEl = document.getElementById("result-header");
    const correctAnswerEl = document.getElementById("correct-answer");
    const eventSummaryEl = document.getElementById("event-summary");
    const nameEntryDiv = document.getElementById("name-entry");
    const submitScoreBtn = document.getElementById("submit-score");
    const shareButton = document.getElementById("share-button");

    // ----------------------------------------------------------------
    // Fetch today's event from the API and initialize game state.
    // ----------------------------------------------------------------
    function fetchEvent() {
        fetch('/api/event')
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    currentClueEl.textContent = "Error loading event.";
                    return;
                }
                currentEvent = data;
                // For game functionality, we assume that the API returns the answer and alternate answers.
                correctAnswer = data.answer ? data.answer.trim().toLowerCase() : "";
                altAnswers = data.alt_answers ? data.alt_answers.map(a => a.trim().toLowerCase()) : [];
                // Initialize clue index and reset remaining guesses.
                currentClueIndex = 0;
                remainingGuesses = 5;
                updateClueDisplay();
                // Display additional event info (year and difficulty)
                document.getElementById("event-year").textContent = currentEvent.year || "????";
                document.getElementById("event-difficulty").textContent = currentEvent.difficulty || "Unknown";
            })
            .catch(error => {
                console.error("Error fetching event:", error);
                currentClueEl.textContent = "Error loading event.";
            });
    }

    // ----------------------------------------------------------------
    // Update the displayed clue and remaining guesses.
    // ----------------------------------------------------------------
    function updateClueDisplay() {
        if (currentEvent && currentEvent.clues && currentClueIndex < currentEvent.clues.length) {
            currentClueEl.textContent = currentEvent.clues[currentClueIndex];
            guessesLeftEl.textContent = remainingGuesses;
        }
    }

    // ----------------------------------------------------------------
    // Handle user's guess submission.
    // ----------------------------------------------------------------
    function handleGuess(e) {
        e.preventDefault();
        const userGuess = guessInput.value.trim().toLowerCase();
        if (!userGuess) return;

        // Check if the guess is correct against the answer or any alternate answer.
        if (userGuess === correctAnswer || altAnswers.includes(userGuess)) {
            finishGame(true);
        } else {
            // Move the current clue to previous clues with animation
            if (currentClueIndex < currentEvent.clues.length) {
                const prevClueText = currentEvent.clues[currentClueIndex];
                const prevClueDiv = document.createElement("div");
                prevClueDiv.className = "clue pop-in";
                prevClueDiv.textContent = prevClueText;
                previousCluesEl.appendChild(prevClueDiv);
            }

            // Move to next clue and decrement remaining guesses.
            currentClueIndex++;
            remainingGuesses--;
            if (remainingGuesses <= 0 || currentClueIndex >= currentEvent.clues.length) {
                finishGame(false);
            } else {
                updateClueDisplay();
            }
        }
        // Clear the input field.
        guessInput.value = "";
    }

    // ----------------------------------------------------------------
    // Finish the game: display the appropriate modal for win or loss.
    // ----------------------------------------------------------------
    function finishGame(success) {
        // Stop further submissions.
        guessForm.removeEventListener("submit", handleGuess);
        const timeTaken = Math.floor((Date.now() - startTime) / 1000); // time in seconds

        // Fill modal with event details.
        correctAnswerEl.textContent = `Answer: ${correctAnswer.toUpperCase()}`;
        eventSummaryEl.textContent = currentEvent.summary || "";

        if (success) {
            resultHeaderEl.textContent = "Congratulations! You guessed correctly!";
            // Show the name entry for leaderboard submission.
            nameEntryDiv.classList.remove("hidden");
            submitScoreBtn.addEventListener("click", submitScore);
        } else {
            resultHeaderEl.textContent = "Game Over!";
            nameEntryDiv.classList.add("hidden");
        }
        gameOverModal.classList.remove("hidden");
    }

    // ----------------------------------------------------------------
    // Submit player's score to the leaderboard via the API.
    // ----------------------------------------------------------------
    function submitScore() {
        const playerName = document.getElementById("player-name").value.trim();
        const xUsername = document.getElementById("x-username").value.trim();
        if (!playerName) {
            alert("Please enter your name for the leaderboard.");
            return;
        }
        const duration = Date.now() - startTime;
        const hours = Math.floor(duration / 3600000);
        const minutes = Math.floor((duration % 3600000) / 60000);
        const seconds = Math.floor((duration % 60000) / 1000);
        const centiseconds = Math.floor((duration % 1000) / 10);

        const formattedTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;

        // Number of clues used is (currentClueIndex + 1)
        const cluesUsed = currentClueIndex + 1;
        const scoreData = {
            name: playerName,
            x_username: xUsername,
            time: formattedTime,
            clues: cluesUsed
        };

        fetch('/api/score', {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(scoreData)
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                alert("Error submitting score. Please try again.");
            } else {
                // Instead of alerting, simply remove the input section from the game-over popup.
                nameEntryDiv.classList.add("hidden");
                // Update the leaderboard display in real time.
                updateLeaderboard();
            }
        })
        .catch(error => {
            console.error("Error submitting score:", error);
            alert("Error submitting score. Please try again.");
        });
    }

    // ----------------------------------------------------------------
    // Update the leaderboard by fetching the top 10 entries from the API.
    // ----------------------------------------------------------------
    function updateLeaderboard() {
        fetch('/api/leaderboard')
            .then(response => response.json())
            .then(data => {
                const leaderboardEntriesEl = document.getElementById("leaderboard-entries");
                leaderboardEntriesEl.innerHTML = ""; // Clear existing entries
                data.forEach((entry, index) => {
                    const entryDiv = document.createElement("div");
                    entryDiv.className = "leaderboard-entry";

                    // Rank
                    const rankSpan = document.createElement("span");
                    rankSpan.className = "rank";
                    rankSpan.textContent = index + 1;
                    entryDiv.appendChild(rankSpan);

                    // Name with optional X profile link and x-logo if linked
                    const nameSpan = document.createElement("span");
                    nameSpan.className = "name";
                    if (entry.x_profile) {
                        const anchor = document.createElement("a");
                        anchor.href = entry.x_profile;
                        anchor.textContent = entry.name;
                        
                        // Create and append the x-logo image
                        const xLogoImg = document.createElement("img");
                        xLogoImg.src = "/static/images/x-logo.svg";
                        xLogoImg.alt = "X Logo";
                        xLogoImg.className = "x-logo";
                        anchor.appendChild(xLogoImg);
                        
                        nameSpan.appendChild(anchor);
                    } else {
                        nameSpan.textContent = entry.name;
                    }
                    entryDiv.appendChild(nameSpan);

                    // Solve time
                    const timeSpan = document.createElement("span");
                    timeSpan.className = "time";
                    timeSpan.textContent = entry.solve_time;
                    entryDiv.appendChild(timeSpan);

                    // Clues used
                    const cluesSpan = document.createElement("span");
                    cluesSpan.className = "clues";
                    cluesSpan.textContent = entry.clues_used;
                    entryDiv.appendChild(cluesSpan);

                    leaderboardEntriesEl.appendChild(entryDiv);
                });
            })
            .catch(err => console.error("Error updating leaderboard:", err));
    }

    // ----------------------------------------------------------------
    // Handle Countdown Timer
    // ----------------------------------------------------------------
    function startCountdown() {
        const countdownHours = document.getElementById("countdown-hours");
        const countdownMinutes = document.getElementById("countdown-minutes");
        const countdownSeconds = document.getElementById("countdown-seconds");
    
        function updateCountdown() {
            const now = new Date();
    
            // Calculate the next UTC midnight
            const nextUtcMidnight = new Date(Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate() + 1, // next day
                0, 0, 0
            ));
    
            const diff = nextUtcMidnight - now;
    
            if (diff <= 0) {
                countdownHours.textContent = "00";
                countdownMinutes.textContent = "00";
                countdownSeconds.textContent = "00";

                location.reload();
                return;
            }
    
            const totalSeconds = Math.floor(diff / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
    
            countdownHours.textContent = String(hours).padStart(2, "0");
            countdownMinutes.textContent = String(minutes).padStart(2, "0");
            countdownSeconds.textContent = String(seconds).padStart(2, "0");
        }
    
        updateCountdown(); // Update immediately
        setInterval(updateCountdown, 1000); // Update every second
    }
     

    // ----------------------------------------------------------------
    // Handle share button click: copy share message to clipboard.
    // ----------------------------------------------------------------
    function handleShare() {
        const shareMessage = `I just played Historle! ${resultHeaderEl.textContent} My time: ${Math.floor((Date.now() - startTime)/1000)} seconds. Check it out!`;
        if (navigator.clipboard) {
            navigator.clipboard.writeText(shareMessage)
                .then(() => console.log("Result copied to clipboard!"))
                .catch(err => console.error("Failed to copy result.", err));
        } else {
            console.log(shareMessage);
        }
    }

    // Event listeners
    modalCloseBtn.addEventListener("click", () => {
        gameOverModal.classList.add("hidden");
    });
    shareButton.addEventListener("click", handleShare);
    guessForm.addEventListener("submit", handleGuess);

    // Fetch the event and leaderboard immediately on page load
    fetchEvent();
    updateLeaderboard();
    startCountdown();

    // Optionally, poll the leaderboard every 10 seconds to keep it updated in real time.
    setInterval(updateLeaderboard, 10000);
});
