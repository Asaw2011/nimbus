<script lang="ts">
  // The RFD panel: a pane on the right of the flow for taking down the
  // decision and feedback while the flow stays in view. Opened from the round
  // home's "Add RFD" button or the toolbar's RFD button.
  import { onDestroy, onMount } from "svelte";
  import { store } from "../model/round.svelte";
  import { ballotNotes, uid, type Ballot } from "../model/types";

  let { onclose }: { onclose: () => void } = $props();

  const round = $derived(store.round);

  // ---- RFD (reason for decision) -----------------------------------------
  // Post-round record only: nothing here is read by the flowing path, and `rfd`
  // stays absent entirely until the first ballot is added, so old saves and
  // rounds you never scored keep exactly the shape they had.
  function addBallot() {
    store.mutate((r) => {
      if (!r.rfd) r.rfd = { ballots: [], notes: "" };
      // First ballot seeds the judge name from the round's judge list; on a
      // panel the rest are blank because that field holds all of them at once.
      const judge = r.rfd.ballots.length === 0 ? (r.judges ?? "").trim() : "";
      const b: Ballot = { id: uid(), judge, winner: "", notes: "" };
      r.rfd.ballots = [...r.rfd.ballots, b];
    });
  }
  function setBallot(id: string, field: keyof Ballot, value: string, coalesce = true) {
    store.mutate((r) => {
      if (!r.rfd) return;
      r.rfd.ballots = r.rfd.ballots.map((b) => {
        if (b.id !== id) return b;
        const next = { ...b, [field]: value };
        // Editing the notes retires the pre-1.2.8 split fields - their content
        // is already in the box being typed into (see ballotNotes), so leaving
        // them would duplicate it the next time this ballot was read.
        if (field === "notes") {
          delete next.reason;
          delete next.feedback;
          delete next.points;
        }
        return next;
      });
    }, coalesce ? { coalesceText: true } : undefined);
  }
  function removeBallot(id: string) {
    store.mutate((r) => {
      if (!r.rfd) return;
      r.rfd.ballots = r.rfd.ballots.filter((b) => b.id !== id);
    });
  }
  function setRfdNotes(value: string) {
    store.mutate((r) => {
      if (!r.rfd) r.rfd = { ballots: [], notes: "" };
      r.rfd.notes = value;
    }, { coalesceText: true });
  }
  /** The panel's overall decision. Not a vote - see the note on RFD.winner. */
  function setRfdWinner(value: "aff" | "neg" | "") {
    store.mutate((r) => {
      if (!r.rfd) r.rfd = { ballots: [], notes: "" };
      r.rfd.winner = value;
    });
  }

  /**
   * Grow a textarea to fit what is in it.
   *
   * Feedback is taken down in a hurry and read back later; a four-line box you
   * have to scroll inside hides most of it. Height follows the content up to a
   * deliberately large cap (set in CSS via max-height), and only past that does
   * it scroll.
   */
  function autoGrow(el: HTMLTextAreaElement) {
    const fit = () => {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    };
    fit();
    el.addEventListener("input", fit);
    // Value can also change from outside (undo, a partner's edit, load).
    const obs = new MutationObserver(fit);
    obs.observe(el, { attributes: true, attributeFilter: ["value"] });
    return {
      update: fit,
      destroy() {
        el.removeEventListener("input", fit);
        obs.disconnect();
      },
    };
  }

  // "AFF (school) wins 2–1" style summary from the ballots that have a vote.
  // Undecided ballots are ignored, so a half-filled panel still reads sensibly.
  const rfdResult = $derived.by(() => {
    const bs = round?.rfd?.ballots ?? [];
    const decided = bs.filter((b) => b.winner);
    if (!decided.length) return "";
    const aff = decided.filter((b) => b.winner === "aff").length;
    const neg = decided.filter((b) => b.winner === "neg").length;
    if (aff === neg) return `Split ${aff}–${neg}`;
    const side = aff > neg ? "AFF" : "NEG";
    const team = (side === "AFF" ? round?.affTeam : round?.negTeam)?.trim();
    const score = decided.length > 1 ? ` ${Math.max(aff, neg)}–${Math.min(aff, neg)}` : "";
    return `${side}${team ? ` (${team})` : ""} wins${score}`;
  });

  // Opening the panel on a round with no RFD yet starts the first ballot, so
  // there is a box to type in straight away - "Add RFD" is one click.
  onMount(() => {
    if (!store.round?.rfd || store.round.rfd.ballots.length === 0) addBallot();
  });
  // ...and closing it with that ballot still untouched takes it away again,
  // so a glance at the panel doesn't leave an empty ballot in the round.
  onDestroy(() => {
    const bs = store.round?.rfd?.ballots ?? [];
    const blank = (b: Ballot) => !b.judge.trim() && !b.winner && !ballotNotes(b).trim();
    if (bs.length && bs.some(blank)) {
      store.mutate((r) => {
        if (!r.rfd) return;
        r.rfd.ballots = r.rfd.ballots.filter((b) => !blank(b));
      });
    }
  });
</script>

{#if round}
  <aside class="rfd-pane" aria-label="RFD">
    <div class="rfd-head">
      <span class="rfd-title">RFD</span>
      {#if rfdResult}<span class="rfd-badge">{rfdResult}</span>{/if}
      <span class="sp"></span>
      <button class="rfd-x" onclick={onclose} title="Close">✕</button>
    </div>
    <div class="rfd-body">
    <!-- PANEL ONLY. A 3-judge panel can split 2–1 and the round still has one
         result, so the overall decision is recorded on its own rather than
         inferred. Deliberately has NO notes box: it is the outcome, not a
         person - the feedback belongs to the judges below it. -->
    {#if (round.rfd?.ballots.length ?? 0) > 1}
      <div class="overall">
        <span class="overall-t">Round won by</span>
        <div class="vote">
          <button
            class="vote-btn aff"
            class:on={round.rfd?.winner === "aff"}
            title="The panel awarded the round to AFF"
            onclick={() => setRfdWinner(round.rfd?.winner === "aff" ? "" : "aff")}
          >AFF</button>
          <button
            class="vote-btn neg"
            class:on={round.rfd?.winner === "neg"}
            title="The panel awarded the round to NEG"
            onclick={() => setRfdWinner(round.rfd?.winner === "neg" ? "" : "neg")}
          >NEG</button>
        </div>
      </div>
    {/if}

    {#each round.rfd?.ballots ?? [] as b (b.id)}
      <div class="ballot">
        <div class="ballot-top">
          <input
            class="ballot-judge"
            value={b.judge}
            placeholder="Judge"
            oninput={(e) => setBallot(b.id, "judge", e.currentTarget.value)}
          />
          <div class="vote">
            <button
              class="vote-btn aff"
              class:on={b.winner === "aff"}
              title="This judge voted AFF"
              onclick={() => setBallot(b.id, "winner", b.winner === "aff" ? "" : "aff", false)}
            >AFF</button>
            <button
              class="vote-btn neg"
              class:on={b.winner === "neg"}
              title="This judge voted NEG"
              onclick={() => setBallot(b.id, "winner", b.winner === "neg" ? "" : "neg", false)}
            >NEG</button>
          </div>
          <button class="icon danger" title="Remove ballot" onclick={() => removeBallot(b.id)}>×</button>
        </div>
        <!-- One block, not three. Grows with what you write and only starts
             scrolling once it is already tall, so a long ballot is readable
             without a scrollbar inside a scrollbar. -->
        <textarea
          class="ballot-notes"
          value={ballotNotes(b)}
          placeholder="Everything they said - RFD, feedback, speaker points…"
          use:autoGrow
          oninput={(e) => setBallot(b.id, "notes", e.currentTarget.value)}
        ></textarea>
      </div>
    {/each}

    <div class="setup-row">
      <button class="chip" onclick={addBallot}>＋ Add ballot{round.rfd && round.rfd.ballots.length ? " (panel)" : ""}</button>
    </div>
    {#if round.rfd && round.rfd.ballots.length}
      <textarea
        class="rfd-notes"
        value={round.rfd?.notes ?? ""}
        placeholder="Other notes about the round…"
        oninput={(e) => setRfdNotes(e.currentTarget.value)}
      ></textarea>
    {/if}
    </div>
  </aside>
{/if}

<style>
  .rfd-pane {
    width: 380px; flex-shrink: 0; min-width: 0;
    display: flex; flex-direction: column;
    border-left: 1px solid var(--border);
    background: var(--bg);
  }
  .rfd-head {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; border-bottom: 1px solid var(--border);
  }
  .rfd-title {
    font-size: 12px; font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--text-dim);
  }
  .sp { flex: 1; }
  .rfd-x {
    background: none; border: none; color: var(--text-dim);
    font-size: 14px; cursor: pointer; padding: 2px 6px; border-radius: 6px;
  }
  .rfd-x:hover { color: var(--text); background: var(--panel); }
  .rfd-body {
    flex: 1; overflow-y: auto;
    display: flex; flex-direction: column; gap: 10px;
    padding: 12px;
  }
  .setup-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .chip {
    background: var(--panel); border: 1px solid var(--border); color: var(--text);
    border-radius: 14px; padding: 4px 12px; font-size: 13px; cursor: pointer;
  }
  .chip:hover { border-color: var(--accent); }
  .icon {
    background: var(--panel); border: 1px solid var(--border); color: var(--text-dim);
    border-radius: 4px; padding: 0 10px; cursor: pointer; align-self: stretch;
  }
  .icon.danger:hover { color: var(--mark-dropped); border-color: var(--mark-dropped); }
  .rfd-badge {
    font-size: 12px;
    font-weight: 700;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 3px 10px;
  }
  .ballot {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    padding: 10px;
  }
  .ballot-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ballot-judge {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 6px 9px;
    font-size: 13px;
    font-weight: 600;
  }
  .vote {
    display: flex;
    gap: 4px;
  }
  .vote-btn {
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text-dim);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }
  /* Uses the same --aff/--neg the grid does, so a custom side color carries. */
  .vote-btn.aff.on {
    background: var(--aff);
    border-color: var(--aff);
    color: #fff;
  }
  .vote-btn.neg.on {
    background: var(--neg);
    border-color: var(--neg);
    color: #fff;
  }
  .ballot textarea,
  .rfd-notes {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 7px 10px;
    font-size: 13px;
    font-family: inherit;
    resize: vertical;
  }
  /* Grows with the text (see the autoGrow action) and only scrolls once it is
     already very tall - feedback is read back later, and a scrollbar inside a
     panel hides most of it. 70vh is roughly a screenful. */
  .ballot-notes {
    min-height: 120px;
    max-height: 70vh;
    line-height: 1.5;
    overflow-y: auto;
  }
  .rfd-notes { min-height: 44px; }
  /* The panel's overall result. No notes box: it is the outcome, not a person. */
  .overall {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    margin-bottom: 8px;
  }
  .overall-t {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
  }
</style>
