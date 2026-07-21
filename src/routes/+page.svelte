<script lang="ts">
  import Dashboard from "$lib/ui/Dashboard.svelte";
  import FlowView from "$lib/ui/FlowView.svelte";
  import { store } from "$lib/model/round.svelte";

  let view: "dashboard" | "flow" = $state("dashboard");
</script>

{#if view === "flow" && store.round}
  <FlowView onexit={() => (view = "dashboard")} />
{:else}
  <Dashboard onopen={() => (view = "flow")} />
{/if}
