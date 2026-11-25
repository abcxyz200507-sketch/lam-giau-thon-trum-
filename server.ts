import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

type DiceValue = 1 | 2 | 3 | 4 | 5 | 6;
type BetSide = 'TAI' | 'XIU';
type ServerRoundPhase = 'LOCKED_COVERED' | 'RESULT';

interface StoredPlayer {
  id: string;
  username: string;
  displayName: string;
  balance: number;
  passwordHash?: string;
  authSource: 'account' | 'google' | 'owner';
  isOnline: boolean;
  createdAt: number;
  lastLoginAt: number;
  lastSeenAt: number;
}

export interface PublicPlayerRecord {
  id: string;
  username: string;
  displayName: string;
  balance: number;
  authSource: 'account' | 'google' | 'owner';
  isOnline: boolean;
  createdAt: number;
  lastLoginAt: number;
  lastSeenAt: number;
}

interface RoundResult {
  sessionId: number;
  dice: [DiceValue, DiceValue, DiceValue];
  total: number;
  outcome: BetSide;
  timestamp: number;
}

interface TableBet {
  tai: number;
  xiu: number;
}

interface PayoutInfo {
  sessionId: number;
  text: string;
  positive: boolean;
}

interface TokenPayload {
  sub: string;
  role: 'player' | 'owner';
  exp: number;
}

interface AuthenticatedSocket extends WebSocket {
  clientId?: string;
  role?: 'player' | 'owner';
  isAlive?: boolean;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, '.data');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const TABLE_FILE = path.join(DATA_DIR, 'table.json');
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');

const INITIAL_BONUS_BALANCE = 100000000;
const INITIAL_OWNER_BALANCE = 1000000000;
const OWNER_ID = '__owner__';
const OWNER_KEY = process.env.OWNER_ACCESS_KEY || '123';
const ROUND_DURATION_MS = 60000;
const SHAKE_DURATION_MS = 1400;
const INITIAL_SESSION_ID = 3339811;
const ONLINE_TTL_MS = 45000;

function ensureDataDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch {
    // Fallback to memory-only if filesystem is read-only
  }
}

function getSessionSecret(): string {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return process.env.SESSION_SECRET;
  }
  ensureDataDir();
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const saved = fs.readFileSync(SECRET_FILE, 'utf8').trim();
      if (saved.length >= 32) return saved;
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
    return generated;
  } catch {
    return crypto.randomBytes(32).toString('hex');
  }
}

const SESSION_SECRET = getSessionSecret();

function loadPlayersFromDisk(): Map<string, StoredPlayer> {
  const map = new Map<string, StoredPlayer>();
  ensureDataDir();
  try {
    if (fs.existsSync(PLAYERS_FILE)) {
      const raw = fs.readFileSync(PLAYERS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item.id === 'string' && typeof item.username === 'string') {
            map.set(item.id, {
              ...(item as StoredPlayer),
              isOnline: false,
            });
          }
        }
      }
    }
  } catch {
    // Ignore malformed file
  }

  if (!map.has(OWNER_ID)) {
    const now = Date.now();
    map.set(OWNER_ID, {
      id: OWNER_ID,
      username: OWNER_ID,
      displayName: 'Chủ Web',
      balance: INITIAL_OWNER_BALANCE,
      authSource: 'owner',
      isOnline: false,
      createdAt: now,
      lastLoginAt: now,
      lastSeenAt: now,
    });
  }
  return map;
}

const playersStore = loadPlayersFromDisk();

function savePlayersToDisk(): void {
  ensureDataDir();
  try {
    fs.writeFileSync(PLAYERS_FILE, JSON.stringify(Array.from(playersStore.values()), null, 2));
  } catch {
    // Ignore disk write failure
  }
}

function generateInitialHistory(): RoundResult[] {
  const presetDice: Array<[DiceValue, DiceValue, DiceValue]> = [
    [5, 4, 2],
    [6, 3, 4],
    [2, 3, 4],
    [1, 2, 5],
    [4, 5, 6],
    [2, 2, 3],
    [1, 4, 3],
    [6, 5, 3],
    [5, 5, 2],
    [4, 4, 5],
    [6, 4, 2],
    [3, 5, 6],
    [5, 6, 1],
    [4, 3, 5],
  ];

  return presetDice.map((dice, index) => {
    const total = dice[0] + dice[1] + dice[2];
    return {
      sessionId: INITIAL_SESSION_ID - 1 - index,
      dice,
      total,
      outcome: total >= 11 ? 'TAI' : 'XIU',
      timestamp: Date.now() - (index + 1) * 60000,
    };
  });
}

function loadTableFromDisk(): { sessionId: number; history: RoundResult[] } {
  ensureDataDir();
  try {
    if (fs.existsSync(TABLE_FILE)) {
      const raw = fs.readFileSync(TABLE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as { sessionId?: number; history?: RoundResult[] };
      if (
        typeof parsed.sessionId === 'number' &&
        Array.isArray(parsed.history) &&
        parsed.history.length > 0
      ) {
        return {
          sessionId: parsed.sessionId,
          history: parsed.history.slice(0, 50),
        };
      }
    }
  } catch {
    // Ignore malformed file
  }
  return {
    sessionId: INITIAL_SESSION_ID,
    history: generateInitialHistory(),
  };
}

function saveTableToDisk(sessionId: number, history: RoundResult[]): void {
  ensureDataDir();
  try {
    fs.writeFileSync(
      TABLE_FILE,
      JSON.stringify({ sessionId, history: history.slice(0, 50) }, null, 2),
    );
  } catch {
    // Ignore disk write failure
  }
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derived = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(keyBuf, derived);
}

function signToken(payload: TokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (!payload || typeof payload.sub !== 'string' || typeof payload.exp !== 'number') {
      return null;
    }
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7).trim();
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ error: 'Thiếu token xác thực.' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(403).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
    return;
  }
  (req as Request & { authPayload?: TokenPayload }).authPayload = payload;
  next();
}

function requireOwner(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ error: 'Yêu cầu xác thực Chủ Web.' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'owner') {
    res.status(403).json({ error: 'Không có quyền truy cập Chủ Web.' });
    return;
  }
  next();
}

function sanitizeDisplayName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback.slice(0, 16);
  const trimmed = value.trim().slice(0, 16);
  return trimmed || fallback.slice(0, 16);
}

function sanitizeAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function rollServerDie(): DiceValue {
  return crypto.randomInt(1, 7) as DiceValue;
}

// ============================================================================
// AUTHORITATIVE SHARED GAME SERVER STATE (1 Shared Table for ALL Players)
// ============================================================================
const persistedTable = loadTableFromDisk();
const roundBets = new Map<string, TableBet>();
const roundPayouts = new Map<string, PayoutInfo>();
const activeSocketCounts = new Map<string, number>();

const tableState = {
  sessionId: persistedTable.sessionId,
  phase: 'LOCKED_COVERED' as ServerRoundPhase,
  countdown: 60,
  isShaking: true,
  roundEndAt: Date.now() + ROUND_DURATION_MS,
  shakeEndAt: Date.now() + SHAKE_DURATION_MS,
  dice: [rollServerDie(), rollServerDie(), rollServerDie()] as [DiceValue, DiceValue, DiceValue],
  taiPot: 0,
  xiuPot: 0,
  taiPlayers: 0,
  xiuPlayers: 0,
  history: persistedTable.history,
};

function recomputePots(): void {
  let taiPot = 0;
  let xiuPot = 0;
  let taiPlayers = 0;
  let xiuPlayers = 0;
  for (const bet of roundBets.values()) {
    if (bet.tai > 0) {
      taiPot += bet.tai;
      taiPlayers += 1;
    }
    if (bet.xiu > 0) {
      xiuPot += bet.xiu;
      xiuPlayers += 1;
    }
  }
  tableState.taiPot = taiPot;
  tableState.xiuPot = xiuPot;
  tableState.taiPlayers = taiPlayers;
  tableState.xiuPlayers = xiuPlayers;
}

function isPlayerCurrentlyOnline(player: StoredPlayer): boolean {
  const socketCount = activeSocketCounts.get(player.id) ?? 0;
  if (socketCount > 0) return true;
  return player.isOnline && Date.now() - player.lastSeenAt < ONLINE_TTL_MS;
}

function toPublicPlayer(player: StoredPlayer): PublicPlayerRecord {
  return {
    id: player.id,
    username: player.username,
    displayName: player.displayName,
    balance: player.balance,
    authSource: player.authSource,
    isOnline: isPlayerCurrentlyOnline(player),
    createdAt: player.createdAt,
    lastLoginAt: player.lastLoginAt,
    lastSeenAt: player.lastSeenAt,
  };
}

function getOtherPlayersList(): PublicPlayerRecord[] {
  return Array.from(playersStore.values())
    .filter((p) => p.id !== OWNER_ID)
    .map(toPublicPlayer)
    .sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      return b.lastLoginAt - a.lastLoginAt;
    });
}

function buildPublicTablePayload() {
  const revealed = tableState.phase === 'RESULT';
  return {
    sessionId: tableState.sessionId,
    phase: tableState.phase,
    countdown: tableState.countdown,
    isShaking: tableState.isShaking,
    dice: revealed ? tableState.dice : null,
    taiPot: tableState.taiPot,
    xiuPot: tableState.xiuPot,
    taiPlayers: tableState.taiPlayers,
    xiuPlayers: tableState.xiuPlayers,
    history: tableState.history,
    onlineCount: Array.from(playersStore.values()).filter(
      (p) => p.id !== OWNER_ID && isPlayerCurrentlyOnline(p),
    ).length,
  };
}

function buildPlayerStatePayload(playerId: string) {
  const player = playersStore.get(playerId);
  const bet = roundBets.get(playerId) ?? { tai: 0, xiu: 0 };
  const payout = roundPayouts.get(playerId);
  const activePayout =
    payout && payout.sessionId === tableState.sessionId
      ? { text: payout.text, positive: payout.positive }
      : null;

  return {
    balance: player?.balance ?? 0,
    displayName: player?.displayName ?? '',
    userTaiBet: bet.tai,
    userXiuBet: bet.xiu,
    lastPayout: activePayout,
  };
}

let wssRef: WebSocketServer | null = null;

function safeSend(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastTableState(): void {
  if (!wssRef) return;
  const msg = JSON.stringify({
    type: 'table:state',
    table: buildPublicTablePayload(),
  });
  for (const client of wssRef.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function sendPlayerStateToClient(playerId: string): void {
  if (!wssRef) return;
  const msg = JSON.stringify({
    type: 'player:state',
    player: buildPlayerStatePayload(playerId),
  });
  for (const client of wssRef.clients) {
    const authClient = client as AuthenticatedSocket;
    if (authClient.readyState === WebSocket.OPEN && authClient.clientId === playerId) {
      authClient.send(msg);
    }
  }
}

function broadcastOwnerPlayers(): void {
  if (!wssRef) return;
  const msg = JSON.stringify({
    type: 'owner:players',
    players: getOtherPlayersList(),
  });
  for (const client of wssRef.clients) {
    const authClient = client as AuthenticatedSocket;
    if (authClient.readyState === WebSocket.OPEN && authClient.role === 'owner') {
      authClient.send(msg);
    }
  }
}

function finalizeServerRound(now: number): void {
  const finalDice: [DiceValue, DiceValue, DiceValue] = [
    rollServerDie(),
    rollServerDie(),
    rollServerDie(),
  ];
  tableState.dice = finalDice;
  tableState.phase = 'RESULT';
  tableState.isShaking = false;

  const total = finalDice[0] + finalDice[1] + finalDice[2];
  const outcome: BetSide = total >= 11 ? 'TAI' : 'XIU';

  roundPayouts.clear();

  for (const [playerId, bet] of roundBets.entries()) {
    const player = playersStore.get(playerId);
    if (!player) continue;
    const winStake = outcome === 'TAI' ? bet.tai : bet.xiu;
    const loseStake = outcome === 'TAI' ? bet.xiu : bet.tai;
    const totalReturn = winStake * 2;
    const net = winStake - loseStake;

    if (totalReturn > 0) {
      player.balance += totalReturn;
    }

    if (bet.tai > 0 || bet.xiu > 0) {
      if (net > 0) {
        roundPayouts.set(playerId, {
          sessionId: tableState.sessionId,
          text: `+${totalReturn.toLocaleString('en-US')} Xu`,
          positive: true,
        });
      } else if (net < 0) {
        roundPayouts.set(playerId, {
          sessionId: tableState.sessionId,
          text: `-${Math.abs(net).toLocaleString('en-US')} Xu`,
          positive: false,
        });
      } else {
        roundPayouts.set(playerId, {
          sessionId: tableState.sessionId,
          text: 'Hòa Xu',
          positive: true,
        });
      }
    }
  }

  const record: RoundResult = {
    sessionId: tableState.sessionId,
    dice: finalDice,
    total,
    outcome,
    timestamp: now,
  };

  tableState.history = [record, ...tableState.history].slice(0, 50);
  savePlayersToDisk();
  saveTableToDisk(tableState.sessionId, tableState.history);

  broadcastTableState();
  for (const playerId of roundBets.keys()) {
    sendPlayerStateToClient(playerId);
  }
  broadcastOwnerPlayers();
}

function startNextServerRound(now: number): void {
  tableState.sessionId += 1;
  tableState.phase = 'LOCKED_COVERED';
  tableState.countdown = 60;
  tableState.isShaking = true;
  tableState.roundEndAt = now + ROUND_DURATION_MS;
  tableState.shakeEndAt = now + SHAKE_DURATION_MS;
  tableState.dice = [rollServerDie(), rollServerDie(), rollServerDie()];
  roundBets.clear();
  roundPayouts.clear();
  recomputePots();
  saveTableToDisk(tableState.sessionId, tableState.history);

  broadcastTableState();

  if (wssRef) {
    for (const client of wssRef.clients) {
      const authClient = client as AuthenticatedSocket;
      if (authClient.readyState === WebSocket.OPEN && authClient.clientId) {
        safeSend(authClient, {
          type: 'player:state',
          player: buildPlayerStatePayload(authClient.clientId),
        });
      }
    }
  }
}

function placeServerBet(
  playerId: string,
  side: BetSide,
  requestedAmount: number,
): { ok: true } | { ok: false; error: string } {
  if (tableState.phase !== 'LOCKED_COVERED' || tableState.countdown <= 10) {
    return { ok: false, error: 'Đã hết thời gian đặt cược phiên này.' };
  }
  const player = playersStore.get(playerId);
  if (!player) {
    return { ok: false, error: 'Không tìm thấy tài khoản người chơi.' };
  }
  const amount = Math.min(sanitizeAmount(requestedAmount), player.balance);
  if (amount <= 0) {
    return { ok: false, error: 'Số dư Xu không đủ để đặt cược.' };
  }

  player.balance -= amount;
  player.lastSeenAt = Date.now();
  const currentBet = roundBets.get(playerId) ?? { tai: 0, xiu: 0 };
  if (side === 'TAI') {
    currentBet.tai += amount;
  } else {
    currentBet.xiu += amount;
  }
  roundBets.set(playerId, currentBet);
  recomputePots();
  savePlayersToDisk();

  sendPlayerStateToClient(playerId);
  broadcastTableState();
  broadcastOwnerPlayers();
  return { ok: true };
}

function clearServerBets(playerId: string): { ok: true } | { ok: false; error: string } {
  if (tableState.phase !== 'LOCKED_COVERED' || tableState.countdown <= 10) {
    return { ok: false, error: 'Không thể hủy cược sau giây thứ 10.' };
  }
  const player = playersStore.get(playerId);
  if (!player) {
    return { ok: false, error: 'Không tìm thấy tài khoản.' };
  }
  const currentBet = roundBets.get(playerId);
  if (!currentBet) {
    return { ok: true };
  }
  const refund = currentBet.tai + currentBet.xiu;
  if (refund > 0) {
    player.balance += refund;
  }
  roundBets.delete(playerId);
  recomputePots();
  savePlayersToDisk();

  sendPlayerStateToClient(playerId);
  broadcastTableState();
  broadcastOwnerPlayers();
  return { ok: true };
}

function startAuthoritativeGameLoop(): void {
  setInterval(() => {
    const now = Date.now();
    const remaining = tableState.roundEndAt - now;
    const secs = Math.max(0, Math.ceil(remaining / 1000));
    let dirty = false;

    const shouldShake = tableState.phase === 'LOCKED_COVERED' && now < tableState.shakeEndAt;
    if (tableState.isShaking !== shouldShake) {
      tableState.isShaking = shouldShake;
      dirty = true;
    }

    if (secs !== tableState.countdown) {
      tableState.countdown = secs;
      dirty = true;
    }

    if (tableState.phase === 'LOCKED_COVERED' && secs <= 10) {
      finalizeServerRound(now);
      return;
    }

    if (remaining <= 0 && tableState.phase === 'RESULT') {
      startNextServerRound(now);
      return;
    }

    if (dirty) {
      broadcastTableState();
    }
  }, 250);
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // Player registration (username + password)
  app.post('/api/auth/register', (req: Request, res: Response) => {
    const rawUsername = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const displayName = sanitizeDisplayName(req.body?.displayName, rawUsername);

    if (rawUsername.length < 3 || rawUsername.length > 24) {
      res.status(400).json({ error: 'Tên Đăng Nhập phải từ 3 đến 24 ký tự.' });
      return;
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(rawUsername)) {
      res.status(400).json({ error: 'Tên Đăng Nhập chỉ gồm chữ, số hoặc dấu _ . -' });
      return;
    }
    if (password.length < 4 || password.length > 64) {
      res.status(400).json({ error: 'Mật Khẩu phải từ 4 đến 64 ký tự.' });
      return;
    }

    const key = rawUsername.toLowerCase();
    if (key === OWNER_ID || playersStore.has(`acc:${key}`)) {
      res.status(409).json({ error: 'Tên Đăng Nhập này đã tồn tại, vui lòng chọn tên khác.' });
      return;
    }

    const now = Date.now();
    const record: StoredPlayer = {
      id: `acc:${key}`,
      username: rawUsername,
      displayName,
      balance: INITIAL_BONUS_BALANCE,
      passwordHash: hashPassword(password),
      authSource: 'account',
      isOnline: true,
      createdAt: now,
      lastLoginAt: now,
      lastSeenAt: now,
    };

    playersStore.set(record.id, record);
    savePlayersToDisk();
    broadcastOwnerPlayers();

    const token = signToken({
      sub: record.id,
      role: 'player',
      exp: now + 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      player: toPublicPlayer(record),
      token,
    });
  });

  // Player login (username + password)
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const rawUsername = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!rawUsername || !password) {
      res.status(400).json({ error: 'Vui lòng nhập đầy đủ Tên Đăng Nhập và Mật Khẩu.' });
      return;
    }

    const key = rawUsername.toLowerCase();
    const record = playersStore.get(`acc:${key}`);
    if (!record || !record.passwordHash) {
      res.status(404).json({ error: 'Tài khoản chưa tồn tại trên máy chủ. Hãy nhấn Đăng Ký.' });
      return;
    }
    if (!verifyPassword(password, record.passwordHash)) {
      res.status(401).json({ error: 'Mật khẩu không chính xác.' });
      return;
    }

    const now = Date.now();
    record.isOnline = true;
    record.lastLoginAt = now;
    record.lastSeenAt = now;
    savePlayersToDisk();
    broadcastOwnerPlayers();

    const token = signToken({
      sub: record.id,
      role: 'player',
      exp: now + 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      player: toPublicPlayer(record),
      token,
    });
  });

  // Sync Google-signed-in player onto the shared server
  app.post('/api/players/google-sync', (req: Request, res: Response) => {
    const uid = typeof req.body?.uid === 'string' ? req.body.uid.trim() : '';
    const rawUsername = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    if (!uid || !/^[a-zA-Z0-9_-]{1,128}$/.test(uid)) {
      res.status(400).json({ error: 'UID không hợp lệ.' });
      return;
    }
    const cleanUsername = (rawUsername || `gg_${uid.slice(0, 8)}`)
      .replace(/[^a-zA-Z0-9_.-]/g, '_')
      .slice(0, 32);
    const id = `gg:${uid}`;
    const existingRecord = playersStore.get(id);
    const displayName = existingRecord?.displayName || sanitizeDisplayName(req.body?.displayName, cleanUsername);
    const now = Date.now();

    const record: StoredPlayer = {
      id,
      username: existingRecord?.username || cleanUsername,
      displayName,
      balance: existingRecord ? existingRecord.balance : INITIAL_BONUS_BALANCE,
      authSource: 'google',
      isOnline: true,
      createdAt: existingRecord?.createdAt ?? now,
      lastLoginAt: now,
      lastSeenAt: now,
    };

    playersStore.set(id, record);
    savePlayersToDisk();
    broadcastOwnerPlayers();

    const token = signToken({
      sub: id,
      role: 'player',
      exp: now + 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ player: toPublicPlayer(record), token });
  });

  // Verify Website Owner key ('123') and return signed owner token + owner account
  app.post('/api/owner/verify', (req: Request, res: Response) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password !== OWNER_KEY) {
      res.status(401).json({ error: 'Mật khẩu chìa khóa không chính xác.' });
      return;
    }

    const now = Date.now();
    const ownerRecord = playersStore.get(OWNER_ID);
    if (ownerRecord) {
      ownerRecord.isOnline = true;
      ownerRecord.lastLoginAt = now;
      ownerRecord.lastSeenAt = now;
      savePlayersToDisk();
    }

    const ownerToken = signToken({
      sub: OWNER_ID,
      role: 'owner',
      exp: now + 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      ownerToken,
      player: ownerRecord ? toPublicPlayer(ownerRecord) : null,
    });
  });

  // Update player heartbeat / displayName
  app.post('/api/players/heartbeat', requireAuth, (req: Request, res: Response) => {
    const authPayload = (req as Request & { authPayload?: TokenPayload }).authPayload;
    if (!authPayload) {
      res.status(401).json({ error: 'Chưa xác thực.' });
      return;
    }
    const record = playersStore.get(authPayload.sub);
    if (!record) {
      res.status(404).json({ error: 'Không tìm thấy người chơi.' });
      return;
    }

    if (typeof req.body?.displayName === 'string' && req.body.displayName.trim()) {
      record.displayName = sanitizeDisplayName(req.body.displayName, record.displayName);
    }
    record.isOnline = true;
    record.lastSeenAt = Date.now();
    savePlayersToDisk();
    broadcastOwnerPlayers();

    res.json({ player: toPublicPlayer(record) });
  });

  // Deposit coins (server-authoritative)
  app.post('/api/player/deposit', requireAuth, (req: Request, res: Response) => {
    const authPayload = (req as Request & { authPayload?: TokenPayload }).authPayload;
    if (!authPayload) {
      res.status(401).json({ error: 'Chưa xác thực.' });
      return;
    }
    const record = playersStore.get(authPayload.sub);
    if (!record) {
      res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
      return;
    }
    const amount = Math.min(sanitizeAmount(req.body?.amount), 10000000000);
    if (amount <= 0) {
      res.status(400).json({ error: 'Số xu nạp không hợp lệ.' });
      return;
    }
    record.balance += amount;
    record.lastSeenAt = Date.now();
    savePlayersToDisk();
    sendPlayerStateToClient(record.id);
    broadcastOwnerPlayers();
    res.json({ balance: record.balance });
  });

  // Withdraw coins (server-authoritative)
  app.post('/api/player/withdraw', requireAuth, (req: Request, res: Response) => {
    const authPayload = (req as Request & { authPayload?: TokenPayload }).authPayload;
    if (!authPayload) {
      res.status(401).json({ error: 'Chưa xác thực.' });
      return;
    }
    const record = playersStore.get(authPayload.sub);
    if (!record) {
      res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
      return;
    }
    const amount = sanitizeAmount(req.body?.amount);
    if (amount <= 0 || amount > record.balance) {
      res.status(400).json({ error: 'Số xu rút không hợp lệ hoặc vượt quá số dư.' });
      return;
    }
    record.balance -= amount;
    record.lastSeenAt = Date.now();
    savePlayersToDisk();
    sendPlayerStateToClient(record.id);
    broadcastOwnerPlayers();
    res.json({ balance: record.balance });
  });

  // Update nickname (server-authoritative)
  app.post('/api/player/nickname', requireAuth, (req: Request, res: Response) => {
    const authPayload = (req as Request & { authPayload?: TokenPayload }).authPayload;
    if (!authPayload) {
      res.status(401).json({ error: 'Chưa xác thực.' });
      return;
    }
    const record = playersStore.get(authPayload.sub);
    if (!record) {
      res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
      return;
    }
    record.displayName = sanitizeDisplayName(req.body?.displayName, record.displayName);
    record.lastSeenAt = Date.now();
    savePlayersToDisk();
    sendPlayerStateToClient(record.id);
    broadcastOwnerPlayers();
    res.json({ displayName: record.displayName });
  });

  // Logout (mark offline)
  app.post('/api/players/logout', (req: Request, res: Response) => {
    const token = extractBearer(req);
    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        const record = playersStore.get(payload.sub);
        if (record) {
          record.isOnline = false;
          record.lastSeenAt = Date.now();
          savePlayersToDisk();
          broadcastOwnerPlayers();
        }
      }
    }
    res.json({ ok: true });
  });

  // Shared table state hydration + REST bet/clear fallback
  app.get('/api/table/state', (req: Request, res: Response) => {
    const token = extractBearer(req);
    const payload = token ? verifyToken(token) : null;
    res.json({
      table: buildPublicTablePayload(),
      player: payload ? buildPlayerStatePayload(payload.sub) : null,
    });
  });

  app.post('/api/table/bet', requireAuth, (req: Request, res: Response) => {
    const authPayload = (req as Request & { authPayload?: TokenPayload }).authPayload;
    if (!authPayload) {
      res.status(401).json({ error: 'Chưa xác thực.' });
      return;
    }
    const side = req.body?.side === 'TAI' || req.body?.side === 'XIU' ? req.body.side : null;
    if (!side) {
      res.status(400).json({ error: 'Cửa cược không hợp lệ.' });
      return;
    }
    const result = placeServerBet(authPayload.sub, side, Number(req.body?.amount));
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({
      table: buildPublicTablePayload(),
      player: buildPlayerStatePayload(authPayload.sub),
    });
  });

  app.post('/api/table/clear', requireAuth, (req: Request, res: Response) => {
    const authPayload = (req as Request & { authPayload?: TokenPayload }).authPayload;
    if (!authPayload) {
      res.status(401).json({ error: 'Chưa xác thực.' });
      return;
    }
    const result = clearServerBets(authPayload.sub);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({
      table: buildPublicTablePayload(),
      player: buildPlayerStatePayload(authPayload.sub),
    });
  });

  // Owner-only endpoint: list all other players across the web
  app.get('/api/owner/players', requireOwner, (_req: Request, res: Response) => {
    res.json({ players: getOtherPlayersList() });
  });

  const isProduction =
    process.env.NODE_ENV === 'production' ||
    (process.env.npm_lifecycle_event === 'start' && fs.existsSync(path.join(__dirname, 'dist', 'index.html')));

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  wssRef = wss;

  wss.on('connection', (ws: AuthenticatedSocket) => {
    ws.isAlive = true;

    // Immediately send current shared table state on connect
    safeSend(ws, {
      type: 'table:state',
      table: buildPublicTablePayload(),
    });

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (rawData) => {
      try {
        const msg = JSON.parse(String(rawData)) as {
          type?: string;
          token?: string;
          side?: BetSide;
          amount?: number;
        };

        if (msg.type === 'auth' && typeof msg.token === 'string') {
          const payload = verifyToken(msg.token);
          if (!payload) {
            safeSend(ws, { type: 'auth:error', error: 'Phiên đăng nhập hết hạn.' });
            return;
          }

          if (ws.clientId && ws.clientId !== payload.sub) {
            const prevCount = activeSocketCounts.get(ws.clientId) ?? 0;
            activeSocketCounts.set(ws.clientId, Math.max(0, prevCount - 1));
          }

          const wasAttached = ws.clientId === payload.sub;
          ws.clientId = payload.sub;
          ws.role = payload.role;

          if (!wasAttached) {
            activeSocketCounts.set(payload.sub, (activeSocketCounts.get(payload.sub) ?? 0) + 1);
          }

          const player = playersStore.get(payload.sub);
          if (player) {
            player.isOnline = true;
            player.lastSeenAt = Date.now();
            savePlayersToDisk();
          }

          safeSend(ws, {
            type: 'table:state',
            table: buildPublicTablePayload(),
          });
          safeSend(ws, {
            type: 'player:state',
            player: buildPlayerStatePayload(payload.sub),
          });
          if (payload.role === 'owner') {
            safeSend(ws, {
              type: 'owner:players',
              players: getOtherPlayersList(),
            });
          } else {
            broadcastOwnerPlayers();
          }
          return;
        }

        if (!ws.clientId) {
          safeSend(ws, { type: 'error', error: 'Chưa xác thực kết nối.' });
          return;
        }

        if (msg.type === 'table:bet' && (msg.side === 'TAI' || msg.side === 'XIU')) {
          const result = placeServerBet(ws.clientId, msg.side, Number(msg.amount));
          if (!result.ok) {
            safeSend(ws, { type: 'bet:error', error: result.error });
          }
          return;
        }

        if (msg.type === 'table:clear') {
          const result = clearServerBets(ws.clientId);
          if (!result.ok) {
            safeSend(ws, { type: 'bet:error', error: result.error });
          }
        }
      } catch {
        // Ignore malformed WebSocket payloads
      }
    });

    ws.on('close', () => {
      if (ws.clientId) {
        const prevCount = activeSocketCounts.get(ws.clientId) ?? 0;
        const nextCount = Math.max(0, prevCount - 1);
        activeSocketCounts.set(ws.clientId, nextCount);
        if (nextCount === 0) {
          const player = playersStore.get(ws.clientId);
          if (player) {
            player.isOnline = false;
            player.lastSeenAt = Date.now();
            savePlayersToDisk();
          }
          broadcastOwnerPlayers();
        }
      }
    });
  });

  // WebSocket keepalive sweep
  setInterval(() => {
    for (const client of wss.clients) {
      const authClient = client as AuthenticatedSocket;
      if (authClient.isAlive === false) {
        authClient.terminate();
        continue;
      }
      authClient.isAlive = false;
      authClient.ping();
    }
  }, 25000);

  startAuthoritativeGameLoop();

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Shared Tài Xỉu Server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
