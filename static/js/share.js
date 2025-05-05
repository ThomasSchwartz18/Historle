// share.js
document.addEventListener("DOMContentLoaded", () => {
    const fbBtn = document.getElementById("share-facebook");
    const twBtn = document.getElementById("share-twitter");
    const igBtn = document.getElementById("share-instagram");
  
    function getShareGrid() {
      const totalClues = 5;
      const usedClues  = window.currentClueIndex; // make sure you exposed this globally
      const brown = "🟫", grey = "⬜";
      return brown.repeat(totalClues - usedClues)
           + grey.repeat(usedClues);
    }
  
    // 1) FACEBOOK
    if (fbBtn) {
      fbBtn.addEventListener("click", () => {
        const url   = "https://historle.com";
        const quote = `My Historle guesses:\n${getShareGrid()}`;
        // Try the quote param
        const shareUrl = 
          `https://www.facebook.com/sharer/sharer.php?` +
          `u=${encodeURIComponent(url)}` +
          `&quote=${encodeURIComponent(quote)}`;
        window.open(shareUrl, "_blank");
  
        // Fallback: also copy to clipboard so user can paste if FB strips the quote
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(`${quote}\n${url}`);
        }
      });
    }
  
    // 2) TWITTER
    if (twBtn) {
      twBtn.addEventListener("click", () => {
        const text = `My Historle guesses:\n${getShareGrid()}`;
        // Only pass the grid as text; let `url` param provide the link
        const tweetUrl =
          `https://twitter.com/intent/tweet?` +
          `text=${encodeURIComponent(text)}` +
          `&url=${encodeURIComponent("https://historle.com")}`;
        window.open(tweetUrl, "_blank");
      });
    }
  
    // 3) INSTAGRAM (clipboard)
    if (igBtn) {
      igBtn.addEventListener("click", () => {
        const msg = `My Historle guesses:\n${getShareGrid()}\nGive it a try: https://historle.com`;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(msg)
            .then(() => alert("Copied! Paste into your Instagram story or DM."))
            .catch(() => alert(msg));
        } else {
          alert(msg);
        }
      });
    }

    // Message / SMS share
    const msgBtn = document.getElementById("share-message");
    if (msgBtn) {
    msgBtn.addEventListener("click", () => {
        const grid = getShareGrid();
        const msg  = `My Historle guesses:\n${grid}\nGive it a try: https://historle.com`;

        if (navigator.share) {
        // Native share (mobile browsers)
        navigator.share({ text: msg })
            .catch(() => {
            // fallback to SMS
            window.location.href = `sms:?body=${encodeURIComponent(msg)}`;
            });
        } else {
        // Desktop fallback → open SMS app (may depend on OS)
        window.location.href = `sms:?body=${encodeURIComponent(msg)}`;
        }
    });
    }
  });
  