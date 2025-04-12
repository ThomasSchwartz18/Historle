document.addEventListener("DOMContentLoaded", () => {
    // **Global Game State Variables**
    let currentEvent = null;
    let currentClueIndex = 0;
    let remainingGuesses = 5;
    // Do not assign the answer details from the event payload
    let correctAnswer = "";
    let altAnswers = [];
    let startTime = Date.now();
    let userXId = null;

    // **DOM Elements**
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
    const nameInput = document.getElementById("player-name");
    const submitScoreBtn = document.getElementById("submit-score");
    const leaderboardEl = document.getElementById("leaderboard-entries");
    const shareButton = document.getElementById("share-button");
    const progressBarEl = document.getElementById("progress-bar");

    // Symbols for the share result grid
    const BROWN_SQUARE = "🟫";
    const GREY_SQUARE = "⬜";

    // Define formatUsername in the global scope of DOMContentLoaded
    function formatUsername(username) {
        return username.includes('@') ? username.split('@')[0] : username;
    }

    // Helper: close modal
    function closeModal(modalId) {
        document.getElementById(modalId).classList.add("hidden");
    }
    // Expose closeModal globally for inline onclick handlers.
    window.closeModal = closeModal;

    // Helper: update win streak display.
    function updateStreakDisplay(streak) {
        const streakDisplay = document.getElementById("streak-count-main");
        const storedUsername = localStorage.getItem("username");
        if (!storedUsername) {
            if (streakDisplay) {
                streakDisplay.textContent = "Login to display win streak";
            }
        } else {
            if (streakDisplay) {
                streakDisplay.textContent = streak;
            }
        }
    }

    // Helper: update X profile link.
    function updateXProfile(username, newXUsername) {
        fetch("/api/update_x_profile", {
            credentials: 'include',
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: username, x_id: newXUsername })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showToast("X profile linked successfully!");
                userXId = newXUsername;
                const xUsernameInput = document.getElementById("x-username");
                if (xUsernameInput) {
                    xUsernameInput.style.display = "none";
                }
            } else {
                showToast(data.error || "Failed to link X profile.", true);
            }
        })
        .catch(err => showToast("Error linking X profile.", true));
    }

    // Helper: escape HTML entities.
    function escapeHTML(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    // Helper: display a toast message.
    function showToast(message, isError = false) {
        const toast = document.getElementById("toast");
        toast.textContent = message;
        toast.className = "toast show" + (isError ? " error" : "");
        setTimeout(() => toast.classList.remove("show"), 3000);
    }

    // Helper: display field error.
    function showFieldError(fieldId, message) {
        const oldError = document.querySelector(`#${fieldId} + .auth-error`);
        if (oldError) oldError.remove();
        const input = document.getElementById(fieldId);
        const error = document.createElement("div");
        error.className = "auth-error";
        error.textContent = message;
        input.insertAdjacentElement("afterend", error);
    }

    // Function to securely reveal the answer and summary.
    function revealAnswerAndSummary() {
        fetch("/api/reveal_answer", {
            credentials: 'include',
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event_date: currentEvent.date })
        })
        .then(res => res.json())
        .then(data => {
            correctAnswerEl.textContent = `Answer: ${escapeHTML(data.answer.toUpperCase())}`;
            eventSummaryEl.textContent = data.summary || "No summary available.";
            correctAnswer = data.answer ? data.answer.trim().toLowerCase() : "";
            altAnswers = data.alt_answers ? data.alt_answers.map(a => a.trim().toLowerCase()) : [];
        })
        .catch(err => {
            correctAnswerEl.textContent = "Error revealing answer.";
            console.error("Reveal failed:", err);
        });
    }

    // Fetch today's event.
    function fetchEvent() {
        fetch("/api/event", {credentials: 'include',})
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    currentClueEl.innerHTML = "<span class='clue-text'>Error loading event.</span>";
                    return;
                }
                currentEvent = data;
                const storedUsername = localStorage.getItem("username");
                if (storedUsername) {
                    // Check with backend if the user already played today.
                    fetch("/api/already_played", {
                        credentials: 'include',
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ username: storedUsername })
                    })
                    .then(res => res.json())
                    .then(result => {
                        if (result.already_played) {
                            revealAnswerAndSummary();
                            currentClueEl.innerHTML = `<span class='clue-text'>You've already played today's event. Come back tomorrow!</span>`;
                            guessForm.style.display = "none";
                        } else {
                            // Reset local game state for a new game.
                            currentClueIndex = 0;
                            remainingGuesses = 5;
                            startTime = Date.now();
                            updateClueDisplay();
                            updateProgressBar();
                            document.getElementById("event-year").textContent = currentEvent.category || "History";
                            document.getElementById("event-difficulty").textContent = currentEvent.difficulty || "Unknown";
                        }
                    })
                    .catch(err => {
                        console.error("Error checking play status:", err);
                        // Fallback: check localStorage
                        const alreadyPlayed = localStorage.getItem("played_" + currentEvent.date);
                        if (alreadyPlayed) {
                            revealAnswerAndSummary();
                            currentClueEl.innerHTML = `<span class='clue-text'>You've already played today's event. Come back tomorrow!</span>`;
                            guessForm.style.display = "none";
                        } else {
                            currentClueIndex = 0;
                            remainingGuesses = 5;
                            startTime = Date.now();
                            updateClueDisplay();
                            updateProgressBar();
                            document.getElementById("event-year").textContent = currentEvent.category || "History";
                            document.getElementById("event-difficulty").textContent = currentEvent.difficulty || "Unknown";
                        }
                    });
                } else {
                    // Non-logged-in users: fallback to localStorage.
                    const alreadyPlayed = localStorage.getItem("played_" + currentEvent.date);
                    if (alreadyPlayed) {
                        revealAnswerAndSummary();
                        currentClueEl.innerHTML = `<span class='clue-text'>You've already played today's event. Come back tomorrow!</span>`;
                        guessForm.style.display = "none";
                        return;
                    }
                    currentClueIndex = 0;
                    remainingGuesses = 5;
                    startTime = Date.now();
                    updateClueDisplay();
                    updateProgressBar();
                    document.getElementById("event-year").textContent = currentEvent.category || "History";
                    document.getElementById("event-difficulty").textContent = currentEvent.difficulty || "Unknown";
                }
            })
            .catch(error => {
                console.error("Error fetching event:", error);
                currentClueEl.innerHTML = "<span class='clue-text'>Error loading event.</span>";
            });
    }

    // Update the current displayed clue.
    function updateClueDisplay() {
        if (currentEvent && currentEvent.clues && currentClueIndex < currentEvent.clues.length) {
            const newClueText = document.createElement("span");
            newClueText.className = "clue-text";
            newClueText.textContent = currentEvent.clues[currentClueIndex];
            currentClueEl.innerHTML = "";
            currentClueEl.appendChild(newClueText);
            guessesLeftEl.textContent = remainingGuesses;
        }
    }

    // Update the progress bar.
    function updateProgressBar() {
        const progress = (remainingGuesses / 5) * 100;
        progressBarEl.style.width = `${progress}%`;
    }

    // Handle user's guess by sending it securely to the backend.
    function handleGuess(e) {
        e.preventDefault();
        const userGuess = guessInput.value.trim().toLowerCase();
        if (!userGuess) return;
        fetch("/api/guess", {
            credentials: 'include',
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                guess: userGuess,
                event_date: currentEvent.date
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.correct) {
                finishGame(true);
            } else {
                // Show the previous clue and update game state.
                if (currentClueIndex < currentEvent.clues.length) {
                    const prevClueText = currentEvent.clues[currentClueIndex];
                    const prevClueDiv = document.createElement("div");
                    prevClueDiv.className = "clue fade-in";
                    prevClueDiv.textContent = prevClueText;
                    previousCluesEl.appendChild(prevClueDiv);
                    setTimeout(() => prevClueDiv.classList.remove("fade-in"), 500);
                }
                currentClueIndex++;
                remainingGuesses--;
                updateProgressBar();
                if (remainingGuesses <= 0 || currentClueIndex >= currentEvent.clues.length) {
                    finishGame(false);
                } else {
                    updateClueDisplay();
                }
            }
        })
        .catch(err => {
            console.error("Guess check failed:", err);
            alert("Something went wrong. Try again.");
        });
        guessInput.value = "";
    }

    // Conclude the game: either on a correct guess or after running out of clues/guesses.
    function finishGame(success) {
        guessForm.removeEventListener("submit", handleGuess);
        const timeTaken = Math.floor((Date.now() - startTime) / 1000);
        localStorage.setItem("played_" + currentEvent.date, "true");
        // Securely fetch and reveal the answer.
        revealAnswerAndSummary();
        const storedUsername = localStorage.getItem("username");
        if (success) {
            if (storedUsername) {
                nameInput.value = storedUsername;
                submitScoreAutomatically(timeTaken, true);
                if (!userXId || userXId === "") {
                    const xUsernameInput = document.getElementById("x-username");
                    if (xUsernameInput) {
                        xUsernameInput.style.display = "block";
                        xUsernameInput.addEventListener("change", function() {
                            const newXUsername = this.value.trim();
                            if (newXUsername !== "") {
                                updateXProfile(storedUsername, newXUsername);
                            }
                        });
                    }
                } else {
                    document.getElementById("x-username").style.display = "none";
                }
                nameEntryDiv.classList.add("hidden");
            } else {
                nameEntryDiv.classList.remove("hidden");
                nameEntryDiv.innerHTML = "<p>Please create an account or log in to join the leaderboard and track your win streaks!</p>" + nameEntryDiv.innerHTML;
                submitScoreBtn.addEventListener("click", submitScore, { once: true });
            }
            resultHeaderEl.textContent = "Congratulations! You guessed correctly!";
        } else {
            resultHeaderEl.textContent = "Game Over!";
            nameEntryDiv.classList.add("hidden");
            if (storedUsername) {
                submitScoreAutomatically(timeTaken, false);
            }
        }
        gameOverModal.classList.remove("hidden");
        updateLeaderboard();
    }

    // Automatically submit score (win or loss) for logged-in users.
    function submitScoreAutomatically(timeTaken, win) {
        const payload = {
            username: localStorage.getItem("username"),
            solve_time: `${Math.floor(timeTaken / 60).toString().padStart(2, '0')}:${(timeTaken % 60).toString().padStart(2, '0')}`,
            clues_used: currentClueIndex + 1,
            event_date: currentEvent.date,
            win: win
        };
        if (userXId && userXId !== "") {
            payload.x_profile = `https://x.com/${userXId}`;
        }
        fetch("/api/submit_score", {
            credentials: 'include',
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showToast(`Score submitted! · Streak: ${data.streak}`);
                updateStreakDisplay(data.streak);
            } else {
                showToast(data.error || "Failed to submit score.", true);
            }
        })
        .catch(err => showToast("Error submitting score.", true));
    }

    // Submit score using manual (non-automatic) submission.
    function submitScore() {
        const name = nameInput.value.trim();
        if (!name) return alert("Please enter your name.");
        const timeTaken = Math.floor((Date.now() - startTime) / 1000);
        const cluesUsed = currentClueIndex + 1;
        const payload = {
            username: name,
            solve_time: timeTaken,
            clues_used: cluesUsed,
            event_date: currentEvent.date,
            win: true
        };
        if (userXId && userXId !== "") {
            payload.x_profile = `https://x.com/${userXId}`;
        }
        fetch("/api/submit_score", {
            credentials: 'include',
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showToast("Score submitted successfully!");
                nameEntryDiv.classList.add("hidden");
                updateLeaderboard();
                updateStreakDisplay(data.streak);
            } else {
                showToast("Error submitting score.", true);
            }
        })
        .catch(err => showToast("Error submitting score.", true));
    }

    // Refresh leaderboard entries.
    function updateLeaderboard() {
        fetch('/api/leaderboard', {credentials: 'include',})
            .then(response => response.json())
            .then(data => {
                const leaderboardEntriesEl = document.getElementById("leaderboard-entries");
                leaderboardEntriesEl.innerHTML = "";
                data.forEach((entry, index) => {
                    const entryDiv = document.createElement("div");
                    entryDiv.className = "leaderboard-entry";
                    const rankSpan = document.createElement("span");
                    rankSpan.className = "rank";
                    rankSpan.textContent = index + 1;
                    entryDiv.appendChild(rankSpan);
                    const nameSpan = document.createElement("span");
                    nameSpan.className = "name";
                    if (entry.x_profile) {
                        const anchor = document.createElement("a");
                        anchor.href = entry.x_profile;
                        anchor.innerHTML = escapeHTML(formatUsername(entry.name));
                        const xLogoImg = document.createElement("img");
                        xLogoImg.src = "/static/images/x-logo.png";
                        xLogoImg.alt = "X Logo";
                        xLogoImg.className = "x-logo";
                        anchor.appendChild(xLogoImg);
                        nameSpan.appendChild(anchor);
                    } else {
                        let displayName = entry.name;
                        if (displayName.includes('@')) {
                        displayName = displayName.split('@')[0];
                        }
                        nameSpan.innerHTML = escapeHTML(displayName);
                    }
                    entryDiv.appendChild(nameSpan);
                    const timeSpan = document.createElement("span");
                    timeSpan.className = "time";
                    timeSpan.textContent = entry.solve_time;
                    entryDiv.appendChild(timeSpan);
                    const cluesSpan = document.createElement("span");
                    cluesSpan.className = "clues";
                    cluesSpan.textContent = entry.clues_used;
                    entryDiv.appendChild(cluesSpan);
                    leaderboardEntriesEl.appendChild(entryDiv);
                });
            })
            .catch(err => console.error("Error updating leaderboard:", err));
    }

    // Countdown timer for the next event.
    function startCountdown() {
        function updateTimer() {
            const now = new Date();
            const tomorrow = new Date(now);
            tomorrow.setUTCDate(now.getUTCDate() + 1);
            tomorrow.setUTCHours(0, 0, 0, 0);
            const timeLeft = tomorrow - now;
            if (timeLeft <= 0) {
                document.getElementById("countdown-hours").textContent = "00";
                document.getElementById("countdown-minutes").textContent = "00";
                document.getElementById("countdown-seconds").textContent = "00";
                fetchEvent();
            } else {
                const hours = Math.floor(timeLeft / (1000 * 60 * 60));
                const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
                document.getElementById("countdown-hours").textContent = `${hours}`;
                document.getElementById("countdown-minutes").textContent = `${minutes}`;
                document.getElementById("countdown-seconds").textContent = `${seconds}`;
            }
        }
        updateTimer();
        setInterval(updateTimer, 1000);
    }

    // Share the game result.
    function handleShare() {
        if (!currentEvent) return;
        const totalGuesses = 5;
        const cluesUsed = currentClueIndex;
        const brownCount = totalGuesses - cluesUsed;
        const greyCount = cluesUsed;
        const guessLine = BROWN_SQUARE.repeat(brownCount) + GREY_SQUARE.repeat(greyCount);
        const shareMessage = `My Historle guesses:\n${guessLine}\nGive it a try: www.historle.com`;
        if (navigator.share) {
            navigator.share({
                title: "Historle Result",
                text: shareMessage,
                url: "https://www.historle.com"
            }).catch(err => console.error("Error sharing:", err));
        } else if (navigator.clipboard) {
            navigator.clipboard.writeText(shareMessage)
                .then(() => alert("Result copied to clipboard!"))
                .catch(err => console.error("Failed to copy result.", err));
        } else {
            alert(shareMessage);
        }
    }

    // Event listeners for UI interactions.
    modalCloseBtn.addEventListener("click", () => {
        gameOverModal.classList.add("hidden");
    });
    shareButton.addEventListener("click", handleShare);
    guessForm.addEventListener("submit", handleGuess);

    // Login and Register modal event bindings.
    document.getElementById("login-btn").addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById("login-modal").classList.remove("hidden");
    });
    // document.getElementById("register-btn").addEventListener("click", (e) => {
    //     e.preventDefault();
    //     document.getElementById("register-modal").classList.remove("hidden");
    // });

    // Attach event listener to the "Login to Track" link in the streak section.
    const streakLogin = document.getElementById("streak-login");
    if (streakLogin) {
        streakLogin.addEventListener("click", (e) => {
            e.preventDefault();
            document.getElementById("login-modal").classList.remove("hidden");
        });
    }

    // New: Attach event listener to the register button within the login modal.
    const loginRegisterBtn = document.getElementById("login-register-btn");
    if (loginRegisterBtn) {
        loginRegisterBtn.addEventListener("click", (e) => {
            e.preventDefault();
            // Close the login modal.
            closeModal("login-modal");
            // Open the register modal.
            document.getElementById("register-modal").classList.remove("hidden");
        });
    }

    document.getElementById("login-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = document.getElementById("login-username").value;
        const password = document.getElementById("login-password").value;
        const res = await fetch("/api/login", {
            credentials: 'include',
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.success) {
            showToast("Login successful!");
            document.getElementById("login-modal").classList.add("hidden");
            document.getElementById("login-btn").style.display = "none";
            // document.getElementById("register-btn").style.display = "none";
            const logoutBtn = document.createElement("a");
            logoutBtn.href = "/logout";
            logoutBtn.className = "navbar-link";
            logoutBtn.id = "logout-btn";
            logoutBtn.title = "Logout";
            const img = document.createElement("img");
            img.src = "/static/images/logout-icon.png";
            img.alt = "logout";
            img.className = "nav-icon logout-icon";
            logoutBtn.appendChild(img);
            document.querySelector(".navbar-links").appendChild(logoutBtn);
            logoutBtn.addEventListener("click", (e) => {
                document.getElementById("user-greeting").textContent = "";
            });
            localStorage.setItem("username", data.username);
            userXId = data.x_id || "";
            // Update the greeting.
            // Helper function: return the substring before '@', if present.
            document.getElementById("user-greeting").textContent = `Hello, ${formatUsername(data.username)}`;
            // Update the streak section to show the streak count instead of the login link.
            const streakContainer = document.getElementById("streak-container");
            if (streakContainer) {
                streakContainer.innerHTML = '<p class="streak-display">🔥 Streak:</p>';
                const streakCount = document.createElement("span");
                streakCount.id = "streak-count-main";
                streakCount.textContent = data.streak !== undefined ? data.streak : "0";
                streakContainer.appendChild(streakCount);
            }
        } else {
            showFieldError("login-username", data.error || "Login failed.");
        }
    });
    document.getElementById("register-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = document.getElementById("reg-username").value;
        const password = document.getElementById("reg-password").value;
        const x_id = document.getElementById("reg-xid").value;
        const res = await fetch("/api/register", {
            credentials: 'include',
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, x_id })
        });
        const data = await res.json();
        if (data.success) {
            showToast("Registration successful!");
            document.getElementById("register-modal").classList.add("hidden");
            localStorage.setItem("username", data.username);
            userXId = data.x_id || "";

            // Update streak container like in login:
            const streakContainer = document.getElementById("streak-container");
            if (streakContainer) {
                streakContainer.innerHTML = '<p class="streak-display">🔥 Streak:</p>';
                const streakCount = document.createElement("span");
                streakCount.id = "streak-count-main";
                streakCount.textContent = data.streak !== undefined ? data.streak : "0";
                streakContainer.appendChild(streakCount);
            }

            // Hide the login button.
            document.getElementById("login-btn").style.display = "none";
            // Create a new logout button similar to the one created in your login handler.
            const logoutBtn = document.createElement("a");
            logoutBtn.href = "/logout";
            logoutBtn.className = "navbar-link";
            logoutBtn.id = "logout-btn";
            logoutBtn.title = "Logout";
            const img = document.createElement("img");
            img.src = "/static/images/logout-icon.png";
            img.alt = "logout";
            img.className = "nav-icon logout-icon";
            logoutBtn.appendChild(img);
            document.querySelector(".navbar-links").appendChild(logoutBtn);
            function formatUsername(username) {
                return username.includes('@') ? username.split('@')[0] : username;
            }

            document.getElementById("user-greeting").textContent = `Hello, ${formatUsername(data.username)}`;
        } else {
            const err = data.error?.toLowerCase() || "";
            if (err.includes("username")) {
                showFieldError("reg-username", data.error);
            } else if (err.includes("password")) {
                showFieldError("reg-password", data.error);
            } else {
                showToast("Something went wrong.", true);
            }
        }
    });

    // Initialize game, countdown, and leaderboard.
    fetchEvent();
    startCountdown();
    updateLeaderboard();
    setInterval(updateLeaderboard, 10000);

    // Debug button to clear the played flag.
    const debugBtn = document.getElementById("debug-btn");
    debugBtn.addEventListener("click", () => {
        console.log("Clearing today's localStorage flag so you can replay.");
        if (currentEvent && currentEvent.date) {
            const key = "played_" + currentEvent.date;
            localStorage.removeItem(key);
            console.log(`Removed localStorage key: ${key}`);
            alert("Local progress reset. Refresh the page to test again.");
        } else {
            console.warn("No currentEvent loaded yet.");
            alert("Event not loaded · try again after the game is fully loaded.");
        }
    });
    document.addEventListener("keydown", (e) => {
        console.log("Key pressed:", e.key, "Shift:", e.shiftKey);
        if (e.shiftKey && e.key.toLowerCase() === "d") {
            const debugBtn = document.getElementById("debug-btn");
            if (debugBtn) {
                debugBtn.style.display = debugBtn.style.display === "none" ? "block" : "none";
            }
        }
    });
});
