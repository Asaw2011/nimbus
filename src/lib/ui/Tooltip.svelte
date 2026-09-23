<script lang="ts">
  // One lightweight tooltip layer for the whole app. It reads the native
  // `title` attribute buttons already carry, suppresses the slow OS tooltip,
  // and shows a styled bubble after a short hover dwell. No per-button wiring:
  // anything with a `title` gets a bubble for free, so the whole toolbar is
  // covered by mounting this once.
  import { onMount } from "svelte";

  let text = $state("");
  let x = $state(0);
  let y = $state(0);
  let show = $state(false);
  let below = $state(false);

  const DELAY = 350; // hover dwell before the bubble appears
  const HALF = 150;  // conservative half-width for edge clamping
  let timer: ReturnType<typeof setTimeout> | null = null;
  // The element we lifted a title off, and its value, so we can put it back —
  // tracked so a title is never lost even if a later handler throws.
  let stripped: { el: Element; title: string } | null = null;

  function restore() {
    if (stripped) {
      stripped.el.setAttribute("title", stripped.title);
      stripped = null;
    }
  }

  function hide() {
    if (timer) { clearTimeout(timer); timer = null; }
    show = false;
    restore();
  }

  function onOver(e: MouseEvent) {
    const target = (e.target as Element | null)?.closest?.("[title]");
    if (!target) return;
    const title = target.getAttribute("title");
    if (!title || !title.trim()) return;
    if (stripped?.el === target) return; // already handling this element
    hide();
    // Lift the native title so the OS bubble never shows alongside ours.
    stripped = { el: target, title };
    target.setAttribute("title", "");
    timer = setTimeout(() => {
      const r = target.getBoundingClientRect();
      text = title;
      // Prefer above the control; flip below when it's near the top edge.
      below = r.top < 48;
      x = Math.max(HALF, Math.min(window.innerWidth - HALF, Math.round(r.left + r.width / 2)));
      y = below ? Math.round(r.bottom + 8) : Math.round(r.top - 8);
      show = true;
    }, DELAY);
  }

  function onOut(e: MouseEvent) {
    if (!stripped) return;
    const related = e.relatedTarget as Element | null;
    // Moving within the same control (button → its icon span) isn't a leave.
    if (related && stripped.el.contains(related)) return;
    hide();
  }

  onMount(() => {
    // Capture phase so it sees the hover before anything can stop propagation.
    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    // A click, scroll or window blur dismisses at once — a bubble left hanging
    // over a menu you just opened is worse than no bubble.
    const dismiss = () => hide();
    document.addEventListener("mousedown", dismiss, true);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      document.removeEventListener("mousedown", dismiss, true);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("blur", dismiss);
      restore();
    };
  });
</script>

{#if show && text}
  <div class="tt" class:below style="left:{x}px; top:{y}px" role="tooltip">{text}</div>
{/if}

<style>
  .tt {
    position: fixed;
    z-index: 200;
    transform: translate(-50%, -100%);
    max-width: 280px;
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 5px 9px;
    font-size: 12px;
    line-height: 1.35;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    pointer-events: none;
    white-space: normal;
    text-align: center;
    animation: tt-in 90ms ease-out;
  }
  .tt.below {
    transform: translate(-50%, 0);
  }
  @keyframes tt-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
