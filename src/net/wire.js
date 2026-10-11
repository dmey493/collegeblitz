// Wire format shared by every online transport (WebSocket server and peer-to-peer).

// Compact form of one game input.
export function inputMessage(input) {
  return {
    t: 'in',
    mx: Math.round(input.mx * 100) / 100,
    my: Math.round(input.my * 100) / 100,
    tb: input.turbo ? 1 : 0,
    a: input.a | 0,
    j: input.j | 0,
    s: input.s | 0,
    c0: input.c0 | 0,
    c1: input.c1 | 0,
    c2: input.c2 | 0,
    pm: input.pm === 'aim' ? 1 : 0,
  };
}

export const inputKey = (m) => `${m.mx},${m.my},${m.tb},${m.a},${m.j},${m.s},${m.c0},${m.c1},${m.c2},${m.pm}`;

// ...and back into what Match.setInput expects.
export function inputFromMessage(m) {
  return { mx: m.mx, my: m.my, turbo: !!m.tb, a: m.a, j: m.j, s: m.s, c0: m.c0, c1: m.c1, c2: m.c2, pm: m.pm === 1 ? 'aim' : 'icons' };
}
