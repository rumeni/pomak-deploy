/**
 * Starting a replacement and cancelling the previous rest timer must follow
 * that order. If another tab wins the race, the old alarm stays scheduled.
 */
export async function startConfirmedReplacement(
  start: () => Promise<boolean>, hadActive: boolean, cancelRest: () => Promise<void>,
): Promise<boolean> {
  const started = await start()
  if (started && hadActive) void cancelRest().catch(() => undefined)
  return started
}
