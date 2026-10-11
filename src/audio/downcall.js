// The down-and-distance call at the line ("THIRD AND TWELVE"), read by a deep, processed robot
// voice like the arcade original. It is spliced from recorded pieces in ./downs: the down
// ("down-3" = "Third and"), then the distance ("num-12", or "num-20" + "num-5" for 25, or "goal").
// 1st and 30, the call you hear most, is one recording ("first-30").

// clip names for a call, in order
export function downCallParts(dn, tg, goal) {
  if (!(dn >= 1 && dn <= 4)) return [];
  if (dn === 1 && tg === 30 && !goal) return ['first-30'];
  return [`down-${dn}`, ...(goal ? ['goal'] : numberParts(tg))];
}

// "num-7", "num-30", or tens + units for 21..99
export function numberParts(n) {
  n = Math.min(99, Math.max(1, Math.round(n)));
  if (n <= 20 || n % 10 === 0) return [`num-${n}`];
  return [`num-${n - (n % 10)}`, `num-${n % 10}`];
}
