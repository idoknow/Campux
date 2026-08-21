export type LatestRequestGate = {
  begin: () => number;
  isCurrent: (generation: number) => boolean;
  invalidate: () => void;
};

export function createLatestRequestGate(): LatestRequestGate {
  let generation = 0;
  return {
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(candidate) {
      return candidate === generation;
    },
    invalidate() {
      generation += 1;
    },
  };
}
