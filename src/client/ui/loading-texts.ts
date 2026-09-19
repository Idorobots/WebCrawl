export const LOADING_THOUGHTS: readonly string[] = [
  "Bribing the RNG…",
  "Reticulating splines…",
  "Translating HTML into hallways…",
  "Compiling the dungeon…",
  "Consulting the DOM oracle…",
  "Grepping for loot tables…",
  "Forking the mainframe…",
  "Waking up the sentries…",
  "Untangling the DOM tree…",
  "Charging the portals…",
  "Feeding the packet storm…",
  "Sweeping for robot spies…",
  "Rendering enough bullets…",
  "Negotiating with the robots…",
  "Rolling 1d20 for ambushes…",
  "Sharpening the token slinger…",
  "Indexing the abyss…",
  "Compiling shaders and grudges…",
  "Counting pixels…",
  "Asking the boss for a raise…",
  "Deleting node_modules…",
  "Rewriting it in Rust…",
  "Waiting for the cooldown…",
  "Overflowing the stack…",
  "Mining the devtools…",
  "Watering the server plants…",
  "Feeding the hamsters…",
  "Aligning the pixels…",
  "Squashing imaginary bugs…",
  "Partitioning the dungeon…",
  "Teaching the AI to fear stairs…",
  "Brewing coffee for the CPUs…",
  "Rubber-ducking the architecture…",
  "Pretending this is multiplayer…",
  "Caching the uncached…",
  "Recursing responsibly…",
  "Soldering the circuits…",
  "Listening to the fans spin up…",
  "Defragmenting the walls…",
  "Autocompleting your doom…",
  "Optimizing nothing in particular…",
];

export function createThoughtPicker(
  thoughts: readonly string[] = LOADING_THOUGHTS,
  random: () => number = Math.random,
): () => string {
  let bag: string[] = [];
  let previous: string | null = null;
  const refill = (): void => {
    bag = [...thoughts];
    for (let i = bag.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [bag[i], bag[j]] = [bag[j]!, bag[i]!];
    }
    if (bag.length > 1 && bag[bag.length - 1] === previous) {
      const target = Math.floor(random() * (bag.length - 1));
      [bag[bag.length - 1], bag[target]] = [bag[target]!, bag[bag.length - 1]!];
    }
  };
  return () => {
    if (bag.length === 0) refill();
    const next = bag.pop()!;
    previous = next;
    return next;
  };
}