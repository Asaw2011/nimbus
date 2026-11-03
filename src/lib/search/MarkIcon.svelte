<script lang="ts">
  // Falcon's star and pin, so a marked file looks the same in both apps
  let { kind, filled = true }: { kind: "star" | "pin"; filled?: boolean } = $props();
  const D = {
    star: "M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z",
    pin: "M5.5 1.8h5l-.8 4.4 2.6 2.6v1H8.6V14L8 14.8 7.4 14V9.8H3.7v-1l2.6-2.6z",
  };
</script>

<svg viewBox="0 0 16 16" aria-hidden="true" class="mark-ico" class:filled>
  <path d={D[kind]} />
</svg>

<style>
  .mark-ico { width: 14px; height: 14px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linejoin: round; }
  .mark-ico.filled { fill: currentColor; }
</style>
