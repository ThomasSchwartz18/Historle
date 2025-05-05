// articles.js

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".toggle-article").forEach(link => {
      link.addEventListener("click", e => {
        e.preventDefault();
        const post = link.closest(".post");
        const full = post.querySelector(".full-article");
        full.classList.toggle("hidden");
        link.textContent = full.classList.contains("hidden")
          ? "show more →"
          : "show less ↑";
      });
    });
  });
  