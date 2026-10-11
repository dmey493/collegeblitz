// Room codes and player names, shared by the game rooms and the matchmaking API.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export const makeCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
export const isCode = (c) => /^[A-Z]{4}$/.test(String(c || ''));
export const cleanName = (s, n = 12) => String(s || 'PLAYER').toUpperCase().replace(/[^A-Z0-9 _.-]/g, '').slice(0, n) || 'PLAYER';
