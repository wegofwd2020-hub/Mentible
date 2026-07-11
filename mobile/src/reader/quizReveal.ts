// Interactive quiz reveal for the native web reader (spec 2026-07-11): the learner
// taps an option to commit; the question then locks and reveals right/wrong + the
// explanation. App-owned handlers over the already-sanitized DOM — nothing new is
// injected, so the DOMPurify boundary is untouched. State lives entirely in the DOM
// (a `data-answered` value per `.quiz-q`), so a remount resets the quiz.
//
// Runs AFTER sanitization, like the KaTeX/Mermaid passes in enhance.ts. Web-only.

/** Wire click-to-answer on every `.quiz-q` under `node`. */
export function wireQuizzes(node: HTMLElement): void {
  for (const question of Array.from(node.querySelectorAll<HTMLElement>(".quiz-q"))) {
    const options = question.querySelector<HTMLElement>(".quiz-options");
    if (!options) continue;

    options.addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>(".quiz-opt");
      if (!btn || !options.contains(btn)) return;
      if (question.getAttribute("data-answered")) return; // locked after the first pick

      question.setAttribute("data-answered", btn.getAttribute("data-oid") ?? "");
      btn.classList.add(
        "picked",
        btn.getAttribute("data-correct") === "true" ? "correct" : "incorrect",
      );
      question
        .querySelector<HTMLElement>('.quiz-opt[data-correct="true"]')
        ?.classList.add("correct");

      for (const b of Array.from(question.querySelectorAll<HTMLElement>(".quiz-opt"))) {
        b.setAttribute("disabled", "");
        b.removeAttribute("tabindex");
      }
      question.querySelector<HTMLElement>(".quiz-reveal")?.removeAttribute("hidden");
    });
  }
}
