/**
 * Whether a HUD bar should replay its pulse animation.
 *
 * The pulse is driven by the bar's ratio, not its rendered width: the CSSOM
 * normalizes serialized percentages (e.g. "70.00000000000001%" reads back as
 * "70%"), so comparing width strings reports a change on every render and the
 * bar flashes on unrelated updates. The first render never pulses.
 */
export function hudBarRatioChanged(previous: number | undefined, ratio: number): boolean {
  return previous !== undefined && previous !== ratio;
}
