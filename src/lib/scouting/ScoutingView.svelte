<script lang="ts">
  import { onMount } from "svelte";
  import { scouting, teamReportHtml, type ScoutDoc } from "./scouting.svelte";
  import { tournaments, type ScannedFlow } from "../model/tournaments.svelte";

  let { onexit, onopenflow }: { onexit: () => void; onopenflow: (path: string) => void } =
    $props();

  let selSchoolId = $state<string | null>(null);
  let selTeamId = $state<string | null>(null);

  // What's open/expanded in the main panel.
  let openTourneyId = $state<string | null>(null);
  let openRoundId = $state<string | null>(null);
  let openDocId = $state<string | null>(null);
  let openPosId = $state<string | null>(null);
  let confirmDel = $state<string | null>(null);

  // Add-item state.
  let addingSchool = $state(false);
  let newSchool = $state("");
  let addTeamFor = $state<string | null>(null);
  let newTeamCode = $state("");
  let addingTourney = $state(false);
  let newTourney = $state("");
  let addRoundFor = $state<string | null>(null);  // tourneyId
  let newRoundName = $state("");

  let allFlows = $state<ScannedFlow[]>([]);
  let status = $state("");

  onMount(async () => {
    await scouting.init();
    await tournaments.init();
    allFlows = await tournaments.scanAllFlows();
    if (scouting.schools.length === 0) addingSchool = true;
  });

  const selSchool = $derived(scouting.schools.find((s) => s.id === selSchoolId) ?? null);
  const selTeam = $derived(selSchool?.teams.find((t) => t.id === selTeamId) ?? null);

  // Flows auto-matched by full "School Code" string.
  const teamFlows = $derived.by((): ScannedFlow[] => {
    if (!selSchool || !selTeam) return [];
    const key = `${selSchool.name} ${selTeam.code}`.trim().toLowerCase();
    if (!key) return [];
    return allFlows.filter((f) => f.haystack.includes(key)).sort((a, b) => b.modified - a.modified);
  });

  const sortedSchools = $derived([...scouting.schools].sort((a, b) => a.name.localeCompare(b.name)));

  function selectTeam(schoolId: string, teamId: string) {
    selSchoolId = schoolId;
    selTeamId = teamId;
    openTourneyId = null; openRoundId = null; openDocId = null; openPosId = null;
    addingTourney = false; addRoundFor = null; status = "";
  }

  function addSchool() {
    if (!newSchool.trim()) return;
    const s = scouting.addSchool(newSchool);
    newSchool = ""; addingSchool = false;
    selSchoolId = s.id; addTeamFor = s.id;
  }

  function addTeam(schoolId: string) {
    if (!newTeamCode.trim()) { addTeamFor = null; return; }
    const t = scouting.addTeam(schoolId, newTeamCode);
    newTeamCode = ""; addTeamFor = null;
    if (t) selectTeam(schoolId, t.id);
  }

  function addTourney() {
    if (!newTourney.trim() || !selSchoolId || !selTeamId) return;
    const t = scouting.addTournament(selSchoolId, selTeamId, newTourney);
    newTourney = ""; addingTourney = false;
    if (t) { openTourneyId = t.id; addRoundFor = t.id; newRoundName = ""; }
  }

  function addRound(tourneyId: string) {
    if (!selSchoolId || !selTeamId) return;
    const tourney = selTeam?.tournaments.find((t) => t.id === tourneyId);
    const name = newRoundName.trim() || `Round ${(tourney?.rounds.length ?? 0) + 1}`;
    const r = scouting.addRound(selSchoolId, selTeamId, tourneyId, name);
    newRoundName = ""; addRoundFor = null;
    if (r) openRoundId = r.id;
  }

  function onUpload(e: Event, tourneyId: string, roundId: string, owner: "you" | "them") {
    if (!selSchoolId || !selTeamId) return;
    const input = e.currentTarget as HTMLInputElement;
    const files = input.files;
    if (!files) return;
    let done = 0; let ok = 0;
    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const doc = scouting.addDoc(selSchoolId!, selTeamId!, tourneyId, roundId, file.name, reader.result as ArrayBuffer, owner);
          if (doc) { ok++; openDocId = doc.id; }
        } catch (err) {
          status = `Couldn't read ${file.name}: ${err instanceof Error ? err.message : err}`;
        }
        if (++done === files.length && ok) status = `Added ${ok} doc${ok === 1 ? "" : "s"}.`;
      };
      reader.readAsArrayBuffer(file);
    }
    input.value = "";
  }

  async function exportReport() {
    if (!selSchool || !selTeam) return;
    const { exportTextToDownloads } = await import("../model/blobs");
    const safe = `${selSchool.name} ${selTeam.code}`.replace(/[^A-Za-z0-9-_ ]+/g, "").trim() || "team";
    try {
      const path = await exportTextToDownloads(`${safe}-scouting.html`, teamReportHtml(selSchool, selTeam));
      status = `Saved to ${path}`;
    } catch (e) {
      status = `Export failed: ${e instanceof Error ? e.message : e}`;
    }
  }

  function del(key: string, fn: () => void) {
    if (confirmDel !== key) {
      confirmDel = key;
      setTimeout(() => { if (confirmDel === key) confirmDel = null; }, 3000);
      return;
    }
    confirmDel = null; fn();
  }
</script>

<div class="scout">
  <div class="topbar">
    <button class="back" onclick={onexit}>←</button>
    <span class="title">Scouting</span>
    <span class="sub">School → Team → Tournament → Round → Docs</span>
  </div>

  <div class="body">
    <!-- Sidebar: schools → teams -->
    <aside class="side">
      <div class="side-hd">
        <span class="side-label">Schools</span>
        <button class="add-btn" onclick={() => { addingSchool = true; newSchool = ""; }}>+ School</button>
      </div>

      {#if addingSchool}
        <div class="new-school">
          <!-- svelte-ignore a11y_autofocus -->
          <input placeholder="School name" bind:value={newSchool} autofocus
            onkeydown={(e) => { if (e.key === "Enter") addSchool(); if (e.key === "Escape") addingSchool = false; }} />
          <div class="row">
            <button class="chip primary" onclick={addSchool}>Add</button>
            <button class="chip" onclick={() => (addingSchool = false)}>Cancel</button>
          </div>
        </div>
      {/if}

      <div class="school-list">
        {#each sortedSchools as s (s.id)}
          <div class="school-block">
            <div class="school-row">
              <span class="s-name">{s.name}</span>
              <span class="s-actions">
                <button class="tiny" onclick={() => { addTeamFor = s.id; newTeamCode = ""; selSchoolId = s.id; }}>+ team</button>
                <button class="tiny danger" onclick={() => del("s" + s.id, () => {
                    scouting.deleteSchool(s.id);
                    if (selSchoolId === s.id) { selSchoolId = null; selTeamId = null; }
                  })}>{confirmDel === "s" + s.id ? "sure?" : "×"}</button>
              </span>
            </div>

            {#if addTeamFor === s.id}
              <!-- svelte-ignore a11y_autofocus -->
              <input class="team-add" placeholder="Team code (e.g. HJ)" bind:value={newTeamCode} autofocus
                onkeydown={(e) => { if (e.key === "Enter") addTeam(s.id); if (e.key === "Escape") addTeamFor = null; }}
                onblur={() => newTeamCode.trim() ? addTeam(s.id) : (addTeamFor = null)} />
            {/if}

            {#each s.teams as t (t.id)}
              <button class="team" class:active={selTeamId === t.id && selSchoolId === s.id}
                onclick={() => selectTeam(s.id, t.id)}>
                <span class="t-code">{t.code}</span>
                <span class="t-badge">{t.tournaments.reduce((n, x) => n + x.rounds.length, 0)}</span>
              </button>
            {/each}

            {#if s.teams.length === 0 && addTeamFor !== s.id}
              <button class="team muted" onclick={() => { addTeamFor = s.id; newTeamCode = ""; selSchoolId = s.id; }}>
                + add a team
              </button>
            {/if}
          </div>
        {:else}
          <p class="empty-side">No schools yet.</p>
        {/each}
      </div>
    </aside>

    <!-- Main panel -->
    <main class="detail">
      {#if selSchool && selTeam}
        {@const school = selSchool}
        {@const team = selTeam}

        <!-- Team header -->
        <div class="detail-hd">
          <span class="d-school">{school.name}</span>
          <span class="d-sep">›</span>
          <input class="d-code" value={team.code} placeholder="Code"
            oninput={(e) => scouting.updateTeam(school.id, team.id, { code: e.currentTarget.value })} />
          <span class="spacer"></span>
          {#if status}<span class="status-txt">{status}</span>{/if}
          <button class="chip" onclick={exportReport}>⬇ Export</button>
          <button class="chip danger" class:confirming={confirmDel === "tm" + team.id}
            onclick={() => del("tm" + team.id, () => { scouting.deleteTeam(school.id, team.id); selTeamId = null; })}>
            {confirmDel === "tm" + team.id ? "Delete team?" : "Delete"}
          </button>
        </div>

        <!-- Add tournament -->
        <div class="add-row">
          {#if addingTourney}
            <!-- svelte-ignore a11y_autofocus -->
            <input class="add-input" placeholder="Tournament name" bind:value={newTourney} autofocus
              onkeydown={(e) => { if (e.key === "Enter") addTourney(); if (e.key === "Escape") addingTourney = false; }} />
            <button class="chip primary" onclick={addTourney}>Add</button>
            <button class="chip" onclick={() => (addingTourney = false)}>Cancel</button>
          {:else}
            <button class="chip primary" onclick={() => { addingTourney = true; newTourney = ""; }}>+ Tournament</button>
          {/if}
        </div>

        <!-- Tournaments -->
        {#if team.tournaments.length === 0}
          <p class="empty big">No tournaments yet — add one above.</p>
        {:else}
          <div class="tourneys">
            {#each team.tournaments as tourney (tourney.id)}
              <div class="tourney">
                <!-- Tournament header -->
                <div class="tourney-hd">
                  <span class="tourney-icon">🏆</span>
                  <input class="tourney-name" value={tourney.name}
                    oninput={(e) => scouting.renameTournament(school.id, team.id, tourney.id, e.currentTarget.value)} />
                  <span class="tourney-meta">{tourney.rounds.length} round{tourney.rounds.length === 1 ? "" : "s"}</span>
                  <span class="spacer"></span>
                  <button class="tiny" onclick={() => { addRoundFor = tourney.id; newRoundName = ""; openTourneyId = tourney.id; }}>+ round</button>
                  <button class="tiny danger" onclick={() => del("t" + tourney.id, () => {
                      scouting.deleteTournament(school.id, team.id, tourney.id);
                      if (openTourneyId === tourney.id) openTourneyId = null;
                    })}>{confirmDel === "t" + tourney.id ? "sure?" : "×"}</button>
                </div>

                <!-- Add round input -->
                {#if addRoundFor === tourney.id}
                  <div class="add-round-row">
                    <!-- svelte-ignore a11y_autofocus -->
                    <input class="add-input sm" placeholder="Round name (e.g. Round 1, Doubles)" bind:value={newRoundName} autofocus
                      onkeydown={(e) => { if (e.key === "Enter") addRound(tourney.id); if (e.key === "Escape") addRoundFor = null; }} />
                    <button class="chip primary sm" onclick={() => addRound(tourney.id)}>Add</button>
                    <button class="chip sm" onclick={() => (addRoundFor = null)}>Cancel</button>
                  </div>
                {/if}

                <!-- Rounds -->
                <div class="rounds">
                  {#if tourney.rounds.length === 0 && addRoundFor !== tourney.id}
                    <button class="round muted" onclick={() => { addRoundFor = tourney.id; newRoundName = ""; }}>
                      + add a round
                    </button>
                  {/if}
                  {#each tourney.rounds as r (r.id)}
                    {@const isOpen = openRoundId === r.id}
                    <div class="round-card" class:open={isOpen}>
                      <div class="round-hd">
                        <button class="round-toggle" onclick={() => (openRoundId = isOpen ? null : r.id)}>
                          <span class="caret">{isOpen ? "▾" : "▸"}</span>
                        </button>
                        <input class="round-name" value={r.name}
                          oninput={(e) => scouting.updateRound(school.id, team.id, tourney.id, r.id, { name: e.currentTarget.value })} />
                        <span class="round-meta">{r.docs.length} doc{r.docs.length === 1 ? "" : "s"}</span>
                        <span class="spacer"></span>
                        <button class="tiny danger" onclick={() => del("r" + r.id, () => {
                            scouting.deleteRound(school.id, team.id, tourney.id, r.id);
                            if (openRoundId === r.id) openRoundId = null;
                          })}>{confirmDel === "r" + r.id ? "sure?" : "×"}</button>
                      </div>

                      {#if isOpen}
                        <div class="round-body">
                          <textarea class="notes" rows="2"
                            placeholder="Notes — how they went for args, answered your blocks, what to prep…"
                            value={r.notes}
                            oninput={(e) => scouting.updateRound(school.id, team.id, tourney.id, r.id, { notes: e.currentTarget.value })}></textarea>

                          <div class="upload-row">
                            <label class="chip primary file">
                              ⬆ Their docs
                              <input type="file" accept=".docx" multiple
                                onchange={(e) => onUpload(e, tourney.id, r.id, "them")} />
                            </label>
                            <label class="chip file">
                              ⬆ Your docs
                              <input type="file" accept=".docx" multiple
                                onchange={(e) => onUpload(e, tourney.id, r.id, "you")} />
                            </label>
                          </div>

                          {#snippet docSection(docs: ScoutDoc[], label: string)}
                            {#if docs.length}
                              <p class="doc-label">{label}</p>
                              <div class="docs">
                                {#each docs as d (d.id)}
                                  <div class="doc" class:aff={d.side === "aff"} class:neg={d.side === "neg"}>
                                    <div class="doc-hd">
                                      <button class="doc-toggle" onclick={() => (openDocId = openDocId === d.id ? null : d.id)}>
                                        <span class="caret">{openDocId === d.id ? "▾" : "▸"}</span>
                                      </button>
                                      <input class="doc-name" value={d.name}
                                        oninput={(e) => scouting.updateDoc(school.id, team.id, tourney.id, r.id, d.id, { name: e.currentTarget.value })} />
                                      <select class="doc-side" value={d.side}
                                        onchange={(e) => scouting.updateDoc(school.id, team.id, tourney.id, r.id, d.id, { side: e.currentTarget.value as ScoutDoc["side"] })}>
                                        <option value="aff">Aff</option>
                                        <option value="neg">Neg</option>
                                        <option value="unknown">—</option>
                                      </select>
                                      <span class="doc-meta">{d.positions.length} block{d.positions.length === 1 ? "" : "s"}</span>
                                      <span class="spacer"></span>
                                      <button class="tiny danger" onclick={() => del("d" + d.id, () => scouting.deleteDoc(school.id, team.id, tourney.id, r.id, d.id))}>{confirmDel === "d" + d.id ? "sure?" : "×"}</button>
                                    </div>
                                    {#if openDocId === d.id}
                                      <div class="doc-body">
                                        {#each d.positions as p (p.id)}
                                          <div class="pos">
                                            <button class="pos-hd" onclick={() => (openPosId = openPosId === p.id ? null : p.id)}>
                                              <span class="p-name">{p.name}{p.strategy ? " ★" : ""}</span>
                                              <span class="p-meta">{p.tags.length} cards {openPosId === p.id ? "▾" : "▸"}</span>
                                            </button>
                                            {#if openPosId === p.id}
                                              <div class="pos-body">
                                                <textarea class="strat" rows="2"
                                                  placeholder="How they extend this / go for it / answer your blocks…"
                                                  value={p.strategy}
                                                  oninput={(e) => scouting.updatePosition(school.id, team.id, tourney.id, r.id, d.id, p.id, e.currentTarget.value)}></textarea>
                                                {#if p.tags.length}
                                                  <ol class="tags">{#each p.tags as tag, i (i)}<li>{tag}</li>{/each}</ol>
                                                {/if}
                                              </div>
                                            {/if}
                                          </div>
                                        {/each}
                                      </div>
                                    {/if}
                                  </div>
                                {/each}
                              </div>
                            {/if}
                          {/snippet}

                          {@render docSection(r.docs.filter((d) => d.owner === "them"), "Their docs")}
                          {@render docSection(r.docs.filter((d) => d.owner === "you"), "Your docs")}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Flows: auto-matched to this team across all tournaments -->
        <div class="flows-section">
          <p class="flows-label">Flows vs {school.name} {team.code} — organized automatically</p>
          {#if teamFlows.length}
            <div class="flows">
              {#each teamFlows as f (f.path)}
                <button class="flow-chip" onclick={() => onopenflow(f.path)} title={f.path}>
                  📄 <span class="fc-name">{f.name}</span><span class="fc-meta">{f.tournament}</span>
                </button>
              {/each}
            </div>
          {:else}
            <p class="empty-flows">
              Flows appear here automatically when their name or teams include "{school.name} {team.code}".
            </p>
          {/if}
        </div>

      {:else}
        <div class="placeholder">
          <h2>Scout a team</h2>
          <p>Add a school on the left → add the teams at that school → click a team to start tracking tournaments and rounds.</p>
          <button class="chip primary" onclick={() => { addingSchool = true; newSchool = ""; }}>+ Add a school</button>
        </div>
      {/if}
    </main>
  </div>
</div>

<style>
  .scout { height: 100vh; display: flex; flex-direction: column; }
  .topbar { display: flex; align-items: center; gap: 10px; padding: 10px 18px; border-bottom: 1px solid var(--border); background: var(--panel); }
  .back { background: none; border: none; color: var(--text-dim); font-size: 18px; cursor: pointer; }
  .title { font-size: 17px; font-weight: 700; }
  .sub { color: var(--text-dim); font-size: 12px; }
  .body { flex: 1; display: flex; min-height: 0; }

  /* Sidebar */
  .side { width: 250px; border-right: 1px solid var(--border); display: flex; flex-direction: column; background: var(--panel); flex-shrink: 0; }
  .side-hd { display: flex; align-items: center; justify-content: space-between; padding: 10px; }
  .side-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); }
  .add-btn { background: var(--accent); border: none; color: #fff; border-radius: 6px; padding: 5px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
  .new-school { display: flex; flex-direction: column; gap: 6px; padding: 0 10px 10px; }
  .new-school input { background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 6px 8px; font-size: 13px; }
  .school-list { flex: 1; overflow-y: auto; }
  .school-block { border-bottom: 1px solid var(--grid-line); padding-bottom: 4px; }
  .school-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px 2px; }
  .s-name { font-size: 14px; font-weight: 700; }
  .s-actions { display: flex; gap: 4px; }
  .tiny { background: none; border: 1px solid var(--border); color: var(--text-dim); border-radius: 4px; font-size: 10px; padding: 1px 6px; cursor: pointer; }
  .tiny:hover { color: var(--text); border-color: var(--accent); }
  .tiny.danger:hover { color: var(--mark-dropped); border-color: var(--mark-dropped); }
  .team-add { margin: 2px 12px 4px; background: var(--bg); border: 1px solid var(--accent); color: var(--text); border-radius: 6px; padding: 5px 8px; font-size: 13px; width: calc(100% - 24px); box-sizing: border-box; }
  .team { display: flex; justify-content: space-between; align-items: center; width: calc(100% - 12px); margin: 2px 6px; background: none; border: none; border-radius: 6px; color: var(--text); padding: 6px 10px; font-size: 13px; cursor: pointer; text-align: left; }
  .team:hover { background: color-mix(in srgb, var(--accent) 8%, var(--panel)); }
  .team.active { background: color-mix(in srgb, var(--accent) 16%, var(--panel)); font-weight: 600; }
  .team.muted { color: var(--text-dim); font-style: italic; }
  .t-badge { font-size: 11px; color: var(--text-dim); background: var(--bg); border-radius: 10px; padding: 1px 8px; border: 1px solid var(--border); }
  .empty-side { color: var(--text-dim); font-size: 13px; font-style: italic; padding: 20px 16px; text-align: center; }

  /* Main */
  .detail { flex: 1; overflow-y: auto; padding: 20px 28px; }
  .detail-hd { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
  .d-school { font-size: 22px; font-weight: 700; }
  .d-sep { color: var(--text-dim); font-size: 20px; }
  .d-code { width: 70px; background: var(--panel); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 5px 8px; font-size: 18px; font-weight: 700; }
  .spacer { flex: 1; }
  .status-txt { font-size: 12px; color: var(--text-dim); }
  .chip { background: var(--panel); border: 1px solid var(--border); color: var(--text); border-radius: 14px; padding: 5px 14px; font-size: 13px; cursor: pointer; white-space: nowrap; }
  .chip:hover { border-color: var(--accent); }
  .chip.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  .chip.danger { color: var(--mark-dropped); border-color: var(--mark-dropped); }
  .chip.danger.confirming { background: var(--mark-dropped); color: #fff; }
  .chip.sm { padding: 3px 10px; font-size: 12px; }
  .file { position: relative; overflow: hidden; }
  .file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .add-row { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .add-input { flex: 1; max-width: 300px; background: var(--panel); border: 1px solid var(--accent); color: var(--text); border-radius: 6px; padding: 6px 10px; font-size: 13px; }
  .add-input.sm { max-width: 260px; padding: 4px 8px; font-size: 12px; }

  /* Tournaments */
  .tourneys { display: flex; flex-direction: column; gap: 14px; margin-bottom: 28px; }
  .tourney { border: 1px solid var(--border); border-radius: 10px; background: var(--panel); overflow: hidden; }
  .tourney-hd { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--grid-line); }
  .tourney-icon { font-size: 14px; }
  .tourney-name { flex: 1; background: none; border: none; color: var(--text); font-size: 15px; font-weight: 700; padding: 0; }
  .tourney-name:focus { outline: none; border-bottom: 1px solid var(--accent); }
  .tourney-meta { font-size: 11px; color: var(--text-dim); }
  .add-round-row { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-bottom: 1px solid var(--grid-line); background: var(--bg); }

  /* Rounds */
  .rounds { display: flex; flex-direction: column; }
  .round.muted { background: none; border: none; color: var(--text-dim); font-style: italic; font-size: 13px; padding: 8px 14px; cursor: pointer; text-align: left; }
  .round-card { border-bottom: 1px solid var(--grid-line); }
  .round-card:last-child { border-bottom: none; }
  .round-hd { display: flex; align-items: center; gap: 8px; padding: 9px 14px; }
  .round-toggle { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 11px; }
  .round-name { flex: 1; background: none; border: none; color: var(--text); font-size: 14px; font-weight: 600; padding: 0; }
  .round-name:focus { outline: none; border-bottom: 1px solid var(--accent); }
  .round-meta { font-size: 11px; color: var(--text-dim); }
  .round-body { padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 10px; background: var(--bg); }
  .notes { width: 100%; box-sizing: border-box; background: var(--panel); border: 1px solid var(--border); border-left: 3px solid var(--accent); color: var(--text); border-radius: 8px; padding: 8px 10px; font-size: 13px; font-family: inherit; resize: vertical; }
  .upload-row { display: flex; gap: 8px; flex-wrap: wrap; }

  /* Docs */
  .doc-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); margin: 0; }
  .docs { display: flex; flex-direction: column; gap: 5px; }
  .doc { border: 1px solid var(--grid-line); border-radius: 8px; background: var(--panel); border-left: 3px solid var(--border); }
  .doc.aff { border-left-color: var(--aff); }
  .doc.neg { border-left-color: var(--neg); }
  .doc-hd { display: flex; align-items: center; gap: 6px; padding: 7px 10px; }
  .doc-toggle { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 11px; }
  .doc-name { flex: 0 1 auto; min-width: 80px; background: none; border: none; color: var(--text); font-size: 13px; font-weight: 700; padding: 0; }
  .doc-name:focus { outline: none; border-bottom: 1px solid var(--accent); }
  .doc-side { background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 5px; padding: 2px 6px; font-size: 11px; }
  .doc-meta { font-size: 11px; color: var(--text-dim); }
  .doc-body { padding: 2px 12px 10px; display: flex; flex-direction: column; gap: 4px; }
  .pos { border: 1px solid var(--grid-line); border-radius: 6px; background: var(--bg); }
  .pos-hd { width: 100%; text-align: left; background: none; border: none; color: var(--text); padding: 7px 12px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .p-name { font-size: 13px; font-weight: 600; }
  .p-meta { font-size: 11px; color: var(--text-dim); white-space: nowrap; }
  .pos-body { padding: 6px 12px 10px; }
  .strat { width: 100%; box-sizing: border-box; background: var(--panel); border: 1px solid var(--border); border-left: 3px solid var(--mark-star); color: var(--text); border-radius: 7px; padding: 7px 10px; font-size: 13px; font-family: inherit; resize: vertical; margin-bottom: 6px; }
  .tags { margin: 0; padding-left: 20px; font-size: 13px; color: var(--text); }
  .tags li { padding: 2px 0; }

  /* Flows */
  .flows-section { border-top: 1px solid var(--border); padding-top: 14px; margin-top: 4px; }
  .flows-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); margin: 0 0 8px; }
  .flows { display: flex; flex-wrap: wrap; gap: 6px; }
  .flow-chip { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); color: var(--text); padding: 6px 12px; font-size: 13px; cursor: pointer; }
  .flow-chip:hover { border-color: var(--accent); color: var(--accent); }
  .fc-name { font-weight: 600; }
  .fc-meta { font-size: 11px; color: var(--text-dim); }
  .empty-flows { font-size: 12px; color: var(--text-dim); font-style: italic; padding: 10px 14px; border: 1px dashed var(--border); border-radius: 8px; }

  .placeholder { color: var(--text-dim); max-width: 480px; margin-top: 8vh; }
  .placeholder h2 { color: var(--text); }
  .empty { color: var(--text-dim); font-size: 13px; font-style: italic; padding: 16px; text-align: center; }
  .empty.big { padding: 32px 16px; }
  .caret { display: inline-block; width: 12px; }
  .row { display: flex; gap: 6px; }
</style>
