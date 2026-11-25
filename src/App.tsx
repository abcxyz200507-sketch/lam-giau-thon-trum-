import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  HelpCircle,
  Info,
  Trophy,
  Volume2,
  VolumeX,
  Users,
  RotateCcw,
  Coins,
  Wallet,
  User,
  Pencil,
  Check,
  Hand,
  Music,
  LogOut,
  Crown,
} from 'lucide-react';
import { signOut } from 'firebase/auth';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { BetSide, DiceValue, RoundPhase, RoundResult, WithdrawRecord } from './types/game';
import { RedDice } from './components/RedDice';
import { DepositModal, HistoryModal, RulesModal, StatsModal, WithdrawModal } from './components/Modals';
import { BackgroundMusic } from './components/BackgroundMusic';
import { OwnerPlayersBox, TrackedPlayer } from './components/OwnerPlayersBox';
import {
  AuthGateway,
  OWNER_SESSION_KEY,
  OWNER_TOKEN_STORAGE_KEY,
  PLAYER_TOKEN_STORAGE_KEY,
  UserAccount,
  loadAccounts,
  loadOwnerAccount,
  saveAccounts,
  saveOwnerAccount,
} from './components/AuthModal';
import {
  playClickSound,
  playDiceRollSound,
  playResultSound,
  playTickSound,
} from './utils/sound';

const INITIAL_SESSION_ID = 3339811;
const CHIP_OPTIONS = [1000, 10000, 50000, 100000, 500000, 5000000, 50000000] as const;

interface ServerTableState {
  sessionId: number;
  phase: 'LOCKED_COVERED' | 'RESULT';
  countdown: number;
  isShaking: boolean;
  dice: [DiceValue, DiceValue, DiceValue] | null;
  taiPot: number;
  xiuPot: number;
  taiPlayers: number;
  xiuPlayers: number;
  history: RoundResult[];
}

interface ServerPlayerState {
  balance: number;
  displayName: string;
  userTaiBet: number;
  userXiuBet: number;
  lastPayout: { text: string; positive: boolean } | null;
}

function formatCompactChip(val: number): string {
  if (val >= 1000000) return `${val / 1000000}M`;
  if (val >= 1000) return `${val / 1000}K`;
  return String(val);
}

function getVietnamDateTime(): { time: string; date: string } {
  const now = new Date();
  const time = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);
  const date = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(now);
  return { time, date };
}

export default function App() {
  // Shared server-authoritative session & table state
  const [sessionId, setSessionId] = useState<number>(INITIAL_SESSION_ID);
  const [phase, setPhase] = useState<RoundPhase>('LOCKED_COVERED');
  const [countdown, setCountdown] = useState<number>(60);
  const [isShaking, setIsShaking] = useState<boolean>(true);
  const [dice, setDice] = useState<[DiceValue, DiceValue, DiceValue]>([5, 4, 2]);
  const [history, setHistory] = useState<RoundResult[]>([]);

  // Account session state (starts on Register/Login choice if no active user)
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => {
    try {
      const savedKey = localStorage.getItem('tx_current_user_v1');
      if (!savedKey) return null;
      if (savedKey === OWNER_SESSION_KEY) return loadOwnerAccount();
      const activeRaw = localStorage.getItem('tx_active_account_v1');
      if (activeRaw) {
        const parsed = JSON.parse(activeRaw) as UserAccount;
        if (parsed && parsed.username) return parsed;
      }
      const accounts = loadAccounts();
      return accounts[savedKey] ?? null;
    } catch {
      return null;
    }
  });
  const [ownerToken, setOwnerToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(OWNER_TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  });

  // Entertainment account nickname, virtual coins & betting state
  const [nickname, setNickname] = useState<string>(() => {
    try {
      const savedKey = localStorage.getItem('tx_current_user_v1');
      if (savedKey === OWNER_SESSION_KEY) {
        return loadOwnerAccount().displayName;
      }
      const activeRaw = localStorage.getItem('tx_active_account_v1');
      if (activeRaw) {
        const parsed = JSON.parse(activeRaw) as UserAccount;
        if (parsed?.displayName) return parsed.displayName;
      }
      if (savedKey) {
        const accounts = loadAccounts();
        if (accounts[savedKey]?.displayName) return accounts[savedKey].displayName;
      }
      return localStorage.getItem('tx_nickname') || 'TaiXiu_VIP';
    } catch {
      return 'TaiXiu_VIP';
    }
  });
  const [isEditingName, setIsEditingName] = useState<boolean>(false);
  const [draftName, setDraftName] = useState<string>(nickname);
  const [balance, setBalance] = useState<number>(() => {
    try {
      const savedKey = localStorage.getItem('tx_current_user_v1');
      if (savedKey === OWNER_SESSION_KEY) {
        return loadOwnerAccount().balance;
      }
      const activeRaw = localStorage.getItem('tx_active_account_v1');
      if (activeRaw) {
        const parsed = JSON.parse(activeRaw) as UserAccount;
        if (typeof parsed?.balance === 'number') return parsed.balance;
      }
      if (savedKey) {
        const accounts = loadAccounts();
        if (typeof accounts[savedKey]?.balance === 'number') return accounts[savedKey].balance;
      }
    } catch {
      // Ignore
    }
    return 100000000;
  });
  const [pendingAmount, setPendingAmount] = useState<number>(0);
  const [activeSide, setActiveSide] = useState<BetSide | null>(null);
  const [lastSelectedChip, setLastSelectedChip] = useState<number | 'ALL_IN' | null>(null);
  const [userTaiBet, setUserTaiBet] = useState<number>(0);
  const [userXiuBet, setUserXiuBet] = useState<number>(0);
  const [manualOpen, setManualOpen] = useState<boolean>(false);
  const [lastPayoutMessage, setLastPayoutMessage] = useState<{
    text: string;
    positive: boolean;
  } | null>(null);

  // Shared real-time table pots & player counts from server
  const [taiPot, setTaiPot] = useState<number>(0);
  const [xiuPot, setXiuPot] = useState<number>(0);
  const [taiPlayers, setTaiPlayers] = useState<number>(0);
  const [xiuPlayers, setXiuPlayers] = useState<number>(0);
  const [livePlayers, setLivePlayers] = useState<TrackedPlayer[] | null>(null);

  // UI & Audio state
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [bgmEnabled, setBgmEnabled] = useState<boolean>(true);
  const [vnNow, setVnNow] = useState<{ time: string; date: string }>(() => getVietnamDateTime());
  const [activeModal, setActiveModal] = useState<'rules' | 'stats' | 'history' | 'deposit' | 'withdraw' | null>(null);
  const [inspectedRound, setInspectedRound] = useState<RoundResult | null>(null);
  const [withdrawHistory, setWithdrawHistory] = useState<WithdrawRecord[]>([]);

  useEffect(() => {
    const timer = setInterval(() => {
      setVnNow(getVietnamDateTime());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Persist active user's balance & displayName in localStorage, server, and Firestore
  useEffect(() => {
    if (!currentUser) return;
    if (currentUser.isOwner) {
      saveOwnerAccount({
        ...currentUser,
        displayName: nickname,
        balance,
        isOwner: true,
      });
      return;
    }

    try {
      localStorage.setItem(
        'tx_active_account_v1',
        JSON.stringify({
          ...currentUser,
          displayName: nickname,
          balance,
        }),
      );
    } catch {
      // Ignore storage errors
    }

    const key = currentUser.username.toLowerCase();
    const accounts = loadAccounts();
    if (accounts[key]) {
      accounts[key] = {
        ...accounts[key],
        displayName: nickname,
        balance,
      };
      saveAccounts(accounts);
    }

    const syncTimer = setTimeout(() => {
      const playerToken = localStorage.getItem(PLAYER_TOKEN_STORAGE_KEY);
      if (playerToken) {
        void fetch('/api/players/heartbeat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${playerToken}`,
          },
          body: JSON.stringify({ displayName: nickname, balance }),
        }).catch(() => {});
      }

      if (currentUser.authSource === 'google' && currentUser.uid && auth.currentUser?.uid === currentUser.uid) {
        const playerRef = doc(db, 'players', currentUser.uid);
        void updateDoc(playerRef, {
          displayName: nickname.slice(0, 24) || currentUser.username,
          balance: Math.max(0, Math.floor(balance)),
          isOnline: true,
          updatedAt: serverTimestamp(),
        }).catch((err) => {
          handleFirestoreError(err, OperationType.UPDATE, `players/${currentUser.uid}`);
        });
      }
    }, 500);

    return () => clearTimeout(syncTimer);
  }, [currentUser, balance, nickname]);

  // Periodic online presence heartbeat while logged in as a player
  useEffect(() => {
    if (!currentUser || currentUser.isOwner) return;
    const interval = setInterval(() => {
      const playerToken = localStorage.getItem(PLAYER_TOKEN_STORAGE_KEY);
      if (!playerToken) return;
      void fetch('/api/players/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${playerToken}`,
        },
        body: JSON.stringify({ displayName: nickname, balance }),
      }).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [currentUser, nickname, balance]);

  // Lid drag / open state
  const [lidOffset, setLidOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDraggingLid, setIsDraggingLid] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });

  // WebSocket & shared server refs
  const wsRef = useRef<WebSocket | null>(null);
  const lidOpenedLocallyRef = useRef<boolean>(false);
  const lastServerSessionRef = useRef<number | null>(null);
  const lastSoundSessionRef = useRef<number | null>(null);
  const lastTickSecondRef = useRef<number | null>(null);
  const serverPhaseRef = useRef<'LOCKED_COVERED' | 'RESULT'>('LOCKED_COVERED');
  const soundEnabledRef = useRef(soundEnabled);
  const manualOpenRef = useRef(manualOpen);
  const lastPayoutRef = useRef(lastPayoutMessage);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);
  useEffect(() => {
    manualOpenRef.current = manualOpen;
  }, [manualOpen]);
  useEffect(() => {
    lastPayoutRef.current = lastPayoutMessage;
  }, [lastPayoutMessage]);

  const getActiveAuthToken = useCallback((): string | null => {
    try {
      if (currentUser?.isOwner) {
        return ownerToken || localStorage.getItem(OWNER_TOKEN_STORAGE_KEY);
      }
      return localStorage.getItem(PLAYER_TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  }, [currentUser, ownerToken]);

  const applyServerPlayerState = useCallback((playerState: ServerPlayerState) => {
    setBalance(playerState.balance);
    setUserTaiBet(playerState.userTaiBet);
    setUserXiuBet(playerState.userXiuBet);
    setLastPayoutMessage(playerState.lastPayout);
  }, []);

  const applyServerTableState = useCallback((table: ServerTableState) => {
    const isNewRound =
      lastServerSessionRef.current !== null && lastServerSessionRef.current !== table.sessionId;
    lastServerSessionRef.current = table.sessionId;
    serverPhaseRef.current = table.phase;

    setSessionId(table.sessionId);
    setCountdown(table.countdown);
    setIsShaking(table.isShaking);
    setTaiPot(table.taiPot);
    setXiuPot(table.xiuPot);
    setTaiPlayers(table.taiPlayers);
    setXiuPlayers(table.xiuPlayers);
    setHistory(table.history);

    if (isNewRound) {
      lidOpenedLocallyRef.current = false;
      setLidOffset({ x: 0, y: 0 });
      setPendingAmount(0);
      setActiveSide(null);
      setLastSelectedChip(null);
      setInspectedRound(null);
      playDiceRollSound(soundEnabledRef.current);
    }

    if (table.phase === 'LOCKED_COVERED') {
      setPhase('LOCKED_COVERED');
      return;
    }

    if (table.dice) {
      setDice(table.dice);
    }

    const shouldStayCoveredForManual =
      manualOpenRef.current && !lidOpenedLocallyRef.current && table.countdown > 0;

    if (shouldStayCoveredForManual) {
      setPhase('CAN_OPEN');
      if (table.countdown <= 5 && lastTickSecondRef.current !== table.countdown) {
        lastTickSecondRef.current = table.countdown;
        playTickSound(soundEnabledRef.current, true);
      }
    } else {
      setPhase('RESULT');
      if (lastSoundSessionRef.current !== table.sessionId) {
        lastSoundSessionRef.current = table.sessionId;
        playResultSound(soundEnabledRef.current, Boolean(lastPayoutRef.current?.positive));
      }
    }
  }, []);

  // Connect to shared authoritative WebSocket game server
  useEffect(() => {
    if (!currentUser) return;

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const token = getActiveAuthToken();

    // Hydrate initial state via HTTP immediately
    void fetch('/api/table/state', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { table?: ServerTableState; player?: ServerPlayerState | null } | null) => {
        if (disposed || !data) return;
        if (data.table) applyServerTableState(data.table);
        if (data.player) applyServerPlayerState(data.player);
      })
      .catch(() => {});

    const connectWebSocket = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = socket;

      socket.onopen = () => {
        if (disposed) return;
        const latestToken = getActiveAuthToken();
        if (latestToken) {
          socket.send(JSON.stringify({ type: 'auth', token: latestToken }));
        }
      };

      socket.onmessage = (event) => {
        if (disposed) return;
        try {
          const msg = JSON.parse(String(event.data)) as {
            type?: string;
            table?: ServerTableState;
            player?: ServerPlayerState;
            players?: TrackedPlayer[];
          };
          if (msg.type === 'table:state' && msg.table) {
            applyServerTableState(msg.table);
          } else if (msg.type === 'player:state' && msg.player) {
            applyServerPlayerState(msg.player);
          } else if (msg.type === 'owner:players' && Array.isArray(msg.players)) {
            setLivePlayers(msg.players);
          }
        } catch {
          // Ignore malformed WS message
        }
      };

      socket.onclose = () => {
        if (wsRef.current === socket) {
          wsRef.current = null;
        }
        if (!disposed) {
          reconnectTimer = setTimeout(connectWebSocket, 1500);
        }
      };
    };

    connectWebSocket();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [currentUser, getActiveAuthToken, applyServerTableState, applyServerPlayerState]);

  const handleOpenLid = useCallback(() => {
    if (serverPhaseRef.current !== 'RESULT') return;
    lidOpenedLocallyRef.current = true;
    dragStartRef.current.active = false;
    setIsDraggingLid(false);
    setLidOffset({ x: 0, y: 0 });
    setPhase('RESULT');
    if (lastSoundSessionRef.current !== lastServerSessionRef.current) {
      lastSoundSessionRef.current = lastServerSessionRef.current;
      playResultSound(soundEnabledRef.current, Boolean(lastPayoutRef.current?.positive));
    }
  }, []);

  const handleSelectChip = (chip: number) => {
    if (phase !== 'LOCKED_COVERED' || countdown <= 10) return;
    if (balance - pendingAmount < chip) return;
    playClickSound(soundEnabled);
    setLastSelectedChip(chip);
    setPendingAmount((prev) => prev + chip);
  };

  const handleAllIn = () => {
    if (phase !== 'LOCKED_COVERED' || countdown <= 10) return;
    if (balance <= 0 || pendingAmount >= balance) return;
    playClickSound(soundEnabled);
    setLastSelectedChip('ALL_IN');
    setPendingAmount(balance);
  };

  const handleToggleManualOpen = () => {
    playClickSound(soundEnabled);
    const nextManual = !manualOpen;
    manualOpenRef.current = nextManual;
    setManualOpen(nextManual);
    if (!nextManual && serverPhaseRef.current === 'RESULT') {
      handleOpenLid();
    }
  };

  const handlePlaceBet = async (side: BetSide) => {
    if (phase !== 'LOCKED_COVERED' || countdown <= 10) return;
    playClickSound(soundEnabled);

    if (pendingAmount > 0) {
      const amountToCommit = Math.min(pendingAmount, balance);
      if (amountToCommit <= 0) return;
      setPendingAmount(0);
      setActiveSide(side);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: 'table:bet', side, amount: amountToCommit }),
        );
        return;
      }

      const token = getActiveAuthToken();
      if (!token) return;
      try {
        const res = await fetch('/api/table/bet', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ side, amount: amountToCommit }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            table?: ServerTableState;
            player?: ServerPlayerState;
          };
          if (data.table) applyServerTableState(data.table);
          if (data.player) applyServerPlayerState(data.player);
        }
      } catch {
        // Ignore transient network errors
      }
    } else {
      setActiveSide((prev) => (prev === side ? null : side));
    }
  };

  const handleClearBets = async () => {
    if (phase !== 'LOCKED_COVERED' || countdown <= 10) return;
    const refund = userTaiBet + userXiuBet;
    if (refund === 0 && pendingAmount === 0) return;
    playClickSound(soundEnabled);
    setPendingAmount(0);
    setLastSelectedChip(null);

    if (refund > 0) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'table:clear' }));
        return;
      }

      const token = getActiveAuthToken();
      if (!token) return;
      try {
        const res = await fetch('/api/table/clear', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as {
            table?: ServerTableState;
            player?: ServerPlayerState;
          };
          if (data.table) applyServerTableState(data.table);
          if (data.player) applyServerPlayerState(data.player);
        }
      } catch {
        // Ignore transient network errors
      }
    }
  };

  const syncDepositAmount = async (amount: number) => {
    const token = getActiveAuthToken();
    if (!token) {
      setBalance((b) => b + amount);
      return;
    }
    try {
      const res = await fetch('/api/player/deposit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ amount }),
      });
      if (res.ok) {
        const data = (await res.json()) as { balance?: number };
        if (typeof data.balance === 'number') setBalance(data.balance);
      }
    } catch {
      // Ignore network errors
    }
  };

  const handleTopUp = () => {
    playClickSound(soundEnabled);
    void syncDepositAmount(10000000);
  };

  const handleLidPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (phase !== 'CAN_OPEN') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = { x: e.clientX, y: e.clientY, active: true };
    setIsDraggingLid(true);
  };

  const handleLidPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current.active || phase !== 'CAN_OPEN') return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setLidOffset({ x: dx, y: dy });
  };

  const handleSaveNickname = () => {
    const cleaned = draftName.trim().slice(0, 16) || 'TaiXiu_VIP';
    setNickname(cleaned);
    setDraftName(cleaned);
    setIsEditingName(false);
    try {
      localStorage.setItem('tx_nickname', cleaned);
    } catch {
      // Ignore storage errors
    }
    const token = getActiveAuthToken();
    if (token) {
      void fetch('/api/player/nickname', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ displayName: cleaned }),
      }).catch(() => {});
    }
  };

  const handleLidPointerUp = () => {
    if (!dragStartRef.current.active) return;
    dragStartRef.current.active = false;
    setIsDraggingLid(false);
    const dist = Math.hypot(lidOffset.x, lidOffset.y);
    // Tap (< 10px) or dragged far enough (> 65px) opens the lid
    if (dist < 10 || dist >= 65) {
      handleOpenLid();
    } else {
      setLidOffset({ x: 0, y: 0 });
    }
  };

  const handleAuthSuccess = (account: UserAccount) => {
    playClickSound(soundEnabled);
    setCurrentUser(account);
    setNickname(account.displayName);
    setDraftName(account.displayName);
    setBalance(account.balance);
    try {
      setOwnerToken(account.isOwner ? localStorage.getItem(OWNER_TOKEN_STORAGE_KEY) : null);
      localStorage.setItem(
        'tx_current_user_v1',
        account.isOwner ? OWNER_SESSION_KEY : account.username.toLowerCase(),
      );
      localStorage.setItem('tx_active_account_v1', JSON.stringify(account));
      localStorage.setItem('tx_nickname', account.displayName);
    } catch {
      // Ignore storage errors
    }
  };

  const handleLogout = () => {
    playClickSound(soundEnabled);
    const exitingUser = currentUser;
    try {
      const playerToken = localStorage.getItem(PLAYER_TOKEN_STORAGE_KEY);
      if (playerToken) {
        void fetch('/api/players/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${playerToken}` },
        }).catch(() => {});
      }
      if (exitingUser?.authSource === 'google' && exitingUser.uid && auth.currentUser?.uid === exitingUser.uid) {
        void updateDoc(doc(db, 'players', exitingUser.uid), {
          isOnline: false,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
      if (auth.currentUser) {
        void signOut(auth).catch(() => {});
      }
      localStorage.removeItem('tx_current_user_v1');
      localStorage.removeItem('tx_active_account_v1');
      localStorage.removeItem(PLAYER_TOKEN_STORAGE_KEY);
      localStorage.removeItem(OWNER_TOKEN_STORAGE_KEY);
    } catch {
      // Ignore
    }
    setOwnerToken(null);
    setCurrentUser(null);
    setActiveModal(null);
    setIsEditingName(false);
  };

  const currentTotal = dice[0] + dice[1] + dice[2];
  const currentOutcome: BetSide = currentTotal >= 11 ? 'TAI' : 'XIU';
  const taiWon = phase === 'RESULT' && currentOutcome === 'TAI';
  const xiuWon = phase === 'RESULT' && currentOutcome === 'XIU';
  const canBet = phase === 'LOCKED_COVERED' && countdown > 10;
  const recentBeads = history.slice(0, 16).reverse();
  const taiPending = canBet && (activeSide === 'TAI' || activeSide === null) ? pendingAmount : 0;
  const xiuPending = canBet && (activeSide === 'XIU' || activeSide === null) ? pendingAmount : 0;
  const taiUserDisplay = userTaiBet + taiPending;
  const xiuUserDisplay = userXiuBet + xiuPending;

  if (!currentUser) {
    return (
      <>
        <AuthGateway
          onAuthSuccess={handleAuthSuccess}
          onPlaySound={() => playClickSound(soundEnabled)}
        />
        <BackgroundMusic enabled={bgmEnabled} soundEnabled={soundEnabled} />
      </>
    );
  }

  return (
    <div
      className="tx-root min-h-dvh w-full flex flex-col justify-between p-2 sm:p-3 lg:p-4 relative overflow-x-hidden select-none"
      style={{
        background:
          'radial-gradient(ellipse at 50% 35%, #2f1b0c 0%, #160b04 52%, #070402 100%)',
      }}
    >
      {/* Subtle warm ambient gold spotlight behind arena */}
      <div
        className="pointer-events-none fixed inset-0 opacity-45"
        style={{
          background:
            'radial-gradient(circle at 50% 44%, rgba(217, 155, 56, 0.22) 0%, transparent 58%)',
        }}
        aria-hidden="true"
      />

      {/* Main Game Console Container - Full Screen */}
      <main className="tx-main relative z-10 w-full flex-1 flex flex-col justify-between gap-2 sm:gap-3">
        {/* TOP CONSOLE HEADER: Center Rounded Title "TÀI XỈU" + Session ID, Left Account/Balance, Right Utility Buttons */}
        <header className="tx-header flex flex-wrap md:grid md:grid-cols-[1fr_auto_1fr] items-center justify-between gap-2 px-1 sm:px-2">
          {/* Account Nickname + Balance + Deposit */}
          <div className="tx-account-bar w-full md:w-auto flex flex-wrap items-center justify-between md:justify-start gap-2 order-2 md:order-1 md:justify-self-start">
            {/* Nickname Pill (click to edit) */}
            <div className="tx-nickname-pill min-h-[40px] flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/60 border border-amber-500/45 shadow-inner">
              <span
                className={`flex items-center justify-center w-6 h-6 rounded-full shrink-0 ${
                  currentUser.isOwner
                    ? 'bg-gradient-to-b from-yellow-200 via-amber-400 to-amber-600 text-amber-950 ring-1 ring-yellow-200/80 shadow-[0_0_10px_rgba(251,191,36,0.65)]'
                    : 'bg-gradient-to-b from-amber-300 to-amber-600 text-amber-950'
                }`}
              >
                {currentUser.isOwner ? (
                  <Crown className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <User className="w-3.5 h-3.5" aria-hidden="true" />
                )}
              </span>

              {isEditingName ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSaveNickname();
                  }}
                  className="flex items-center gap-1"
                >
                  <input
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    maxLength={16}
                    autoFocus
                    aria-label="Nhập tên tài khoản"
                    className="w-24 bg-amber-950/80 border border-amber-400/70 rounded px-1.5 py-0.5 text-xs font-semibold text-amber-100 outline-none"
                  />
                  <button
                    type="submit"
                    className="p-1 rounded bg-amber-400 text-amber-950 hover:brightness-110"
                    aria-label="Lưu tên tài khoản"
                  >
                    <Check className="w-3 h-3" />
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setDraftName(nickname);
                    setIsEditingName(true);
                  }}
                  className="flex items-center gap-1.5 text-left group focus-visible:outline-2 focus-visible:outline-amber-300 rounded"
                  title="Nhấn để đổi nickname"
                >
                  <span className="font-display text-xs sm:text-sm font-bold text-amber-100 max-w-[110px] truncate">
                    {nickname}
                  </span>
                  <Pencil
                    className="w-3 h-3 text-amber-400/70 group-hover:text-amber-300 shrink-0"
                    aria-hidden="true"
                  />
                </button>
              )}

              {currentUser.isOwner && (
                <span className="px-1.5 py-0.5 rounded bg-gradient-to-b from-yellow-300 via-amber-400 to-amber-600 text-[10px] font-black uppercase tracking-wide text-amber-950 shadow-[0_0_8px_rgba(251,191,36,0.5)] whitespace-nowrap">
                  Chủ Web
                </span>
              )}

              <button
                type="button"
                onClick={handleLogout}
                title="Đăng xuất tài khoản"
                aria-label="Đăng xuất"
                className="ml-0.5 p-1 rounded-lg text-amber-300/75 hover:text-rose-300 hover:bg-rose-950/50 transition-colors shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

            {/* Balance + Deposit */}
            <div className="tx-balance-group flex items-center gap-1.5 sm:gap-2">
              <div className="tx-balance-pill min-h-[40px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/60 border border-amber-500/45 shadow-inner">
                <Coins className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                <span className="font-mono-num text-xs sm:text-sm font-bold text-amber-300">
                  {balance.toLocaleString('en-US')}
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  playClickSound(soundEnabled);
                  setActiveModal('deposit');
                }}
                className="tx-deposit-btn min-h-[40px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 text-xs sm:text-sm font-extrabold shadow-[0_0_12px_rgba(245,158,11,0.35)] hover:brightness-105 active:scale-95 transition-all whitespace-nowrap focus-visible:outline-2 focus-visible:outline-amber-300"
              >
                <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" aria-hidden="true" />
                <span>Nạp tiền</span>
              </button>

              {balance < 10000 && (
                <button
                  type="button"
                  onClick={handleTopUp}
                  className="tx-chip-btn min-h-[40px] px-2.5 py-1.5 rounded-xl bg-amber-500/20 border border-amber-400/60 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 transition-colors whitespace-nowrap"
                >
                  +10M
                </button>
              )}

              {lastPayoutMessage && phase === 'RESULT' && (
                <span
                  className={`font-mono-num text-xs font-bold px-2 py-1 rounded-lg whitespace-nowrap ${
                    lastPayoutMessage.positive
                      ? 'bg-emerald-950/75 text-emerald-300 border border-emerald-500/45'
                      : 'bg-rose-950/75 text-rose-300 border border-rose-500/45'
                  }`}
                >
                  {lastPayoutMessage.text}
                </span>
              )}
            </div>
          </div>

          {/* Top Center Brand Title (Large Rounded Font) */}
          <div className="tx-session-wrap order-1 md:order-2 w-full md:w-auto flex flex-col items-center justify-center md:justify-self-center">
            <h1 className="tx-brand-title font-rounded text-4xl sm:text-5xl lg:text-[54px] font-black tracking-wide gold-text-gradient drop-shadow-[0_4px_14px_rgba(0,0,0,0.95)] leading-none whitespace-nowrap">
              TÀI XỈU
            </h1>
            <p className="tx-brand-subtitle font-rounded text-xs sm:text-sm font-extrabold tracking-wide text-green-400 drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)] leading-tight whitespace-nowrap mt-0.5">
              Nhà cái đến từ thôn TRÙM
            </p>
          </div>

          {/* Right Side: Live Vietnam Time + Session ID Plaque + Utility Action Buttons */}
          <div className="tx-utility-group order-3 w-full md:w-auto flex flex-wrap sm:flex-nowrap items-center justify-between md:justify-end gap-1.5 sm:gap-2 md:justify-self-end">
            <div className="flex items-center gap-1.5 shrink-0">
              <div
                className="p-[2px] rounded-xl gold-metallic-frame shadow-[0_6px_20px_rgba(0,0,0,0.85)] shrink-0"
                title={`Giờ Việt Nam (UTC+7): ${vnNow.time} - ${vnNow.date}`}
              >
                <div className="tx-session-plaque px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-[10px] bg-gradient-to-b from-[#2a170a] via-[#170b04] to-[#0d0501] text-center">
                  <span className="tx-session-label text-[9px] uppercase tracking-wider text-green-400/90 block leading-none mb-0.5">
                    {vnNow.date} · VN
                  </span>
                  <span className="tx-session-id font-mono-num text-xs sm:text-sm font-extrabold tracking-wider text-green-300">
                    {vnNow.time}
                  </span>
                </div>
              </div>

              <div className="p-[2px] rounded-xl gold-metallic-frame shadow-[0_6px_20px_rgba(0,0,0,0.85)] shrink-0">
                <div className="tx-session-plaque px-3 sm:px-4 py-0.5 sm:py-1 rounded-[10px] bg-gradient-to-b from-[#2a170a] via-[#170b04] to-[#0d0501] text-center">
                  <span className="tx-session-label text-[9px] uppercase tracking-widest text-amber-400/75 block leading-none mb-0.5">
                    Phiên hiện tại
                  </span>
                  <span className="tx-session-id font-mono-num text-xs sm:text-sm font-extrabold tracking-wider text-amber-200">
                    #{sessionId}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => {
                playClickSound(soundEnabled);
                setActiveModal('rules');
              }}
              className="tx-icon-btn w-10 h-10 sm:w-11 sm:h-11 rounded-full p-[2px] gold-metallic-frame shadow-lg hover:scale-105 active:scale-95 transition-transform focus-visible:outline-2 focus-visible:outline-amber-300"
              aria-label="Luật chơi"
              title="Luật chơi"
            >
              <span className="flex items-center justify-center w-full h-full rounded-full bg-gradient-to-b from-[#2f1b0a] to-[#0f0702] text-amber-300">
                <HelpCircle className="w-4 h-4 sm:w-5 sm:h-5" />
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                playClickSound(soundEnabled);
                setActiveModal('stats');
              }}
              className="tx-icon-btn w-10 h-10 sm:w-11 sm:h-11 rounded-full p-[2px] gold-metallic-frame shadow-lg hover:scale-105 active:scale-95 transition-transform focus-visible:outline-2 focus-visible:outline-amber-300"
              aria-label="Thống kê phiên"
              title="Thống kê phiên"
            >
              <span className="flex items-center justify-center w-full h-full rounded-full bg-gradient-to-b from-[#2f1b0a] to-[#0f0702] text-amber-300">
                <Info className="w-4 h-4 sm:w-5 sm:h-5" />
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                playClickSound(soundEnabled);
                setActiveModal('history');
              }}
              className="tx-icon-btn w-10 h-10 sm:w-11 sm:h-11 rounded-full p-[2px] gold-metallic-frame shadow-lg hover:scale-105 active:scale-95 transition-transform focus-visible:outline-2 focus-visible:outline-amber-300"
              aria-label="Lịch sử chi tiết"
              title="Lịch sử chi tiết"
            >
              <span className="flex items-center justify-center w-full h-full rounded-full bg-gradient-to-b from-[#2f1b0a] to-[#0f0702] text-amber-300">
                <Trophy className="w-4 h-4 sm:w-5 sm:h-5" />
              </span>
            </button>

            <button
              type="button"
              onClick={() => setBgmEnabled((m) => !m)}
              className="tx-icon-btn w-10 h-10 sm:w-11 sm:h-11 rounded-full p-[2px] gold-metallic-frame shadow-lg hover:scale-105 active:scale-95 transition-transform focus-visible:outline-2 focus-visible:outline-amber-300"
              aria-label={bgmEnabled ? 'Tắt nhạc nền' : 'Bật nhạc nền'}
              title={bgmEnabled ? 'Tắt nhạc nền' : 'Bật nhạc nền'}
            >
              <span className="relative flex items-center justify-center w-full h-full rounded-full bg-gradient-to-b from-[#2f1b0a] to-[#0f0702] text-amber-300">
                <Music className={`w-4 h-4 sm:w-5 sm:h-5 ${bgmEnabled ? '' : 'opacity-45'}`} />
                {!bgmEnabled && (
                  <svg
                    viewBox="0 0 24 24"
                    className="pointer-events-none absolute inset-0 w-full h-full p-2"
                    aria-hidden="true"
                  >
                    <line
                      x1="4"
                      y1="20"
                      x2="20"
                      y2="4"
                      stroke="#f87171"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSoundEnabled((s) => !s)}
              className="tx-icon-btn w-10 h-10 sm:w-11 sm:h-11 rounded-full p-[2px] gold-metallic-frame shadow-lg hover:scale-105 active:scale-95 transition-transform focus-visible:outline-2 focus-visible:outline-amber-300"
              aria-label={soundEnabled ? 'Tắt âm thanh' : 'Bật âm thanh'}
              title={soundEnabled ? 'Tắt âm thanh' : 'Bật âm thanh'}
            >
              <span className="flex items-center justify-center w-full h-full rounded-full bg-gradient-to-b from-[#2f1b0a] to-[#0f0702] text-amber-300">
                {soundEnabled ? (
                  <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />
                ) : (
                  <VolumeX className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500/60" />
                )}
              </span>
            </button>
            </div>
          </div>
        </header>

        {/* MAIN ARCADE BOARD SHELL - Full Screen */}
        <section
          aria-label="Bàn chơi Tài Xỉu"
          className="tx-board-shell flex-1 flex flex-col relative rounded-[24px] sm:rounded-[34px] p-[3px] gold-metallic-frame shadow-[0_24px_70px_rgba(0,0,0,0.95)]"
        >
          <div className="tx-board-inner flex-1 flex flex-col justify-between relative rounded-[21px] sm:rounded-[31px] bronze-console-bg px-3 py-3 sm:px-6 sm:py-5 overflow-hidden">
            {/* Subtle radial inner lighting */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'radial-gradient(ellipse at 50% 42%, rgba(251, 191, 36, 0.16) 0%, transparent 65%)',
              }}
              aria-hidden="true"
            />

            {/* TOP COUNTDOWN & PLAYER COUNT ROW */}
            <div className="tx-countdown-row relative z-20 flex items-center justify-center gap-2 sm:gap-5 mb-3 sm:mb-4">
              {/* TÀI Player Count */}
              <div className="tx-player-pill flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-xl border border-[#e7c48b]/75 bg-gradient-to-b from-[#291306] to-[#110602] shadow-[inset_0_2px_6px_rgba(0,0,0,0.85)]">
                <span className="font-mono-num text-sm sm:text-base font-bold text-amber-100">
                  {taiPlayers.toLocaleString('en-US')}
                </span>
                <Users className="w-4 h-4 text-amber-200" aria-hidden="true" />
              </div>

              {/* Center 60-Second Countdown Shield */}
              <div className="p-[2px] rounded-xl gold-metallic-frame shadow-[0_6px_22px_rgba(0,0,0,0.9)]">
                <div className="tx-countdown-box min-w-[132px] sm:min-w-[162px] px-4 py-1.5 rounded-[10px] bg-gradient-to-b from-[#2f1708] to-[#100602] flex flex-col items-center justify-center">
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={`tx-countdown-num font-mono-num text-3xl sm:text-4xl font-extrabold leading-none ${
                        phase === 'RESULT'
                          ? 'text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.6)]'
                          : phase === 'CAN_OPEN'
                            ? 'text-yellow-300 drop-shadow-[0_0_12px_rgba(253,224,71,0.85)]'
                            : 'text-amber-400 drop-shadow-[0_0_10px_rgba(251,191,36,0.55)]'
                      }`}
                    >
                      {String(countdown).padStart(2, '0')}
                    </span>
                    <span className="text-[11px] font-semibold text-amber-200/75 whitespace-nowrap">
                      {phase === 'LOCKED_COVERED'
                        ? 'Đặt cược'
                        : phase === 'CAN_OPEN'
                          ? 'Mở nắp!'
                          : 'Kết quả'}
                    </span>
                  </div>
                </div>
              </div>

              {/* XỈU Player Count */}
              <div className="tx-player-pill flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-xl border border-[#e7c48b]/75 bg-gradient-to-b from-[#291306] to-[#110602] shadow-[inset_0_2px_6px_rgba(0,0,0,0.85)]">
                <Users className="w-4 h-4 text-amber-200" aria-hidden="true" />
                <span className="font-mono-num text-sm sm:text-base font-bold text-amber-100">
                  {xiuPlayers.toLocaleString('en-US')}
                </span>
              </div>
            </div>

            {/* CORE ARENA GRID: Desktop & Phone Landscape = 3 Columns (TÀI | BOWL | XỈU), Portrait Mobile = Bowl on top + TÀI/XỈU side by side */}
            <div className="tx-arena-grid relative z-10 flex-1 grid grid-cols-2 md:grid-cols-12 items-center gap-3 sm:gap-4 lg:gap-6">
              {/* CENTER DICE BOWL (First in portrait mobile flow, middle on desktop/landscape) */}
              <div className="tx-bowl-col relative col-span-2 md:col-span-4 md:order-2 flex flex-col items-center justify-center my-1 md:my-0">
                <div
                  className={`relative p-[5px] sm:p-[6px] rounded-full gold-bezel-ring shadow-[0_14px_45px_rgba(0,0,0,0.95)] ${
                    isShaking ? 'animate-bowl-shake' : ''
                  }`}
                >
                  {/* Inner obsidian dish */}
                  <div
                    className="tx-bowl-dish relative w-[240px] h-[240px] sm:w-[276px] sm:h-[276px] lg:w-[324px] lg:h-[324px] xl:w-[356px] xl:h-[356px] rounded-full flex flex-col items-center justify-center border-2 border-amber-200/35 overflow-hidden"
                    style={{
                      background:
                        'radial-gradient(circle at 50% 42%, #241911 0%, #0d0805 62%, #050302 100%)',
                      boxShadow: 'inset 0 12px 35px rgba(0, 0, 0, 0.95)',
                    }}
                  >
                    {/* Golden glow ring inside bowl when result is revealed */}
                    {phase === 'RESULT' && (
                      <div
                        className="pointer-events-none absolute inset-0 rounded-full animate-win-burst"
                        aria-hidden="true"
                      />
                    )}

                    {/* 3 Red Dice arranged in classic triangle (1 top, 2 bottom) */}
                    <div
                      className={`relative z-10 flex flex-col items-center justify-center transition-transform duration-300 ${
                        phase === 'RESULT' ? 'tx-dice-result-shift -translate-y-4 sm:-translate-y-5 scale-95' : ''
                      }`}
                    >
                      <div className="tx-dice-row-top mb-2 sm:mb-3">
                        <RedDice
                          value={dice[0]}
                          isRolling={false}
                          variant="a"
                          size="lg"
                          showBadge={phase === 'RESULT'}
                        />
                      </div>
                      <div className="tx-dice-row-bottom flex items-center gap-4 sm:gap-6">
                        <RedDice
                          value={dice[1]}
                          isRolling={false}
                          variant="b"
                          size="lg"
                          showBadge={phase === 'RESULT'}
                        />
                        <RedDice
                          value={dice[2]}
                          isRolling={false}
                          variant="c"
                          size="lg"
                          showBadge={phase === 'RESULT'}
                        />
                      </div>
                    </div>

                    {/* ORNATE COVER LID (Cái nắp che xúc xắc) when LOCKED_COVERED or CAN_OPEN */}
                    {(phase === 'LOCKED_COVERED' || phase === 'CAN_OPEN') && (
                      <div
                        role={phase === 'CAN_OPEN' ? 'button' : undefined}
                        tabIndex={phase === 'CAN_OPEN' ? 0 : undefined}
                        aria-label={
                          phase === 'CAN_OPEN'
                            ? 'Nắp bát sẵn sàng mở, nhấn hoặc kéo để xem kết quả'
                            : 'Nắp bát đang đóng trong thời gian đặt cược'
                        }
                        onPointerDown={handleLidPointerDown}
                        onPointerMove={handleLidPointerMove}
                        onPointerUp={handleLidPointerUp}
                        onPointerCancel={handleLidPointerUp}
                        onKeyDown={(e) => {
                          if (phase === 'CAN_OPEN' && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            handleOpenLid();
                          }
                        }}
                        style={{
                          transform: `translate3d(${lidOffset.x}px, ${lidOffset.y}px, 0)`,
                          touchAction: 'none',
                        }}
                        className={`absolute inset-0 z-30 rounded-full flex flex-col items-center justify-center p-4 border-4 border-amber-300/75 shadow-[0_14px_35px_rgba(0,0,0,0.95),inset_0_8px_22px_rgba(255,224,150,0.28)] ${
                          isDraggingLid ? 'transition-none cursor-grabbing' : 'transition-transform duration-200'
                        } ${phase === 'CAN_OPEN' ? 'cursor-grab hover:brightness-105' : 'cursor-default'}`}
                      >
                        {/* Metallic sculpted dome surface */}
                        <div
                          className="absolute inset-0 rounded-full pointer-events-none"
                          style={{
                            background:
                              'radial-gradient(circle at 38% 30%, #7c5024 0%, #44260e 45%, #1c0e04 82%, #0e0601 100%)',
                          }}
                          aria-hidden="true"
                        />

                        {/* Ornamental concentric gold ring */}
                        <div
                          className="pointer-events-none absolute inset-4 rounded-full border border-amber-300/35"
                          aria-hidden="true"
                        />

                        {/* Center Raised Knob & Prompt */}
                        <div className="relative z-10 flex flex-col items-center text-center gap-2 pointer-events-none">
                          <div
                            className={`tx-lid-knob w-16 h-16 sm:w-20 sm:h-20 rounded-full p-[3px] gold-metallic-frame shadow-[0_8px_20px_rgba(0,0,0,0.9)] ${
                              phase === 'CAN_OPEN' ? 'ring-2 ring-yellow-300/80' : ''
                            }`}
                          >
                            <div className="w-full h-full rounded-full bg-gradient-to-b from-[#5e3817] via-[#2b1506] to-[#120701] flex items-center justify-center border border-amber-200/40">
                              <span className="font-display text-xs sm:text-sm font-black tracking-wider text-amber-200 uppercase">
                                {isShaking ? 'XÓC...' : phase === 'CAN_OPEN' ? 'MỞ' : `${countdown}s`}
                              </span>
                            </div>
                          </div>

                          {phase === 'CAN_OPEN' ? (
                            <div className="tx-lid-hint px-3 py-1 rounded-lg bg-black/70 border border-yellow-300/70 shadow-lg">
                              <span className="font-display text-xs sm:text-sm font-bold text-yellow-200 block">
                                Chạm hoặc kéo để mở nắp
                              </span>
                            </div>
                          ) : isShaking ? (
                            <div className="tx-lid-hint px-3 py-1 rounded-lg bg-black/65 border border-amber-500/35">
                              <span className="font-display text-xs font-semibold text-amber-200/85 block">
                                Đang xóc xúc xắc...
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    )}

                    {/* RESULT ANNOUNCEMENT BANNER INSIDE BOWL */}
                    {phase === 'RESULT' && (
                      <div className="tx-result-banner absolute bottom-3 sm:bottom-4 inset-x-4 z-20 flex flex-col items-center text-center">
                        <div className="px-3.5 py-1.5 rounded-xl bg-black/85 border border-amber-400/75 shadow-[0_6px_20px_rgba(0,0,0,0.9)]">
                          <div className="tx-result-banner-sub font-mono-num text-[11px] sm:text-xs text-amber-200/90">
                            {dice[0]} + {dice[1]} + {dice[2]} ={' '}
                            <span className="font-bold text-white">{currentTotal} điểm</span>
                          </div>
                          <div
                            className={`tx-result-banner-title font-display text-xl sm:text-2xl font-black tracking-wider leading-tight ${
                              currentOutcome === 'TAI'
                                ? 'text-amber-300 tai-win-glow'
                                : 'text-stone-100 drop-shadow-[0_0_12px_rgba(255,255,255,0.65)]'
                            }`}
                          >
                            {currentOutcome === 'TAI' ? 'TÀI' : 'XỈU'}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Small Hand Toggle Button: Checked = Player opens lid; Unchecked (diagonal slash) = System auto-opens at second 10 */}
                <button
                  type="button"
                  onClick={handleToggleManualOpen}
                  aria-pressed={manualOpen}
                  aria-label={
                    manualOpen
                      ? 'Người chơi tự mở nắp (đang bật)'
                      : 'Hệ thống tự mở nắp ở giây thứ 10 (đang bật)'
                  }
                  title={manualOpen ? 'Người chơi tự mở nắp' : 'Hệ thống tự mở giây thứ 10'}
                  className={`tx-hand-btn absolute bottom-1 right-2 sm:bottom-2 sm:right-4 z-40 w-10 h-10 sm:w-11 sm:h-11 rounded-full p-[2px] gold-metallic-frame shadow-[0_6px_16px_rgba(0,0,0,0.9)] hover:scale-105 active:scale-95 transition-transform focus-visible:outline-2 focus-visible:outline-amber-300 ${
                    manualOpen ? 'ring-2 ring-yellow-300/75' : ''
                  }`}
                >
                  <span
                    className={`relative flex items-center justify-center w-full h-full rounded-full bg-gradient-to-b from-[#2f1b0a] to-[#0f0702] ${
                      manualOpen ? 'text-amber-300' : 'text-amber-200/50'
                    }`}
                  >
                    <Hand className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
                    {!manualOpen && (
                      <svg
                        viewBox="0 0 24 24"
                        className="pointer-events-none absolute inset-0 w-full h-full p-1.5"
                        aria-hidden="true"
                      >
                        <line
                          x1="4"
                          y1="20"
                          x2="20"
                          y2="4"
                          stroke="#f87171"
                          strokeWidth="2.6"
                          strokeLinecap="round"
                        />
                      </svg>
                    )}
                  </span>
                </button>
              </div>

              {/* LEFT ZONE: TÀI */}
              <div className="tx-side-col-left col-span-1 md:col-span-4 md:order-1 flex flex-col items-center gap-2.5 sm:gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (!canBet) return;
                    playClickSound(soundEnabled);
                    setActiveSide('TAI');
                  }}
                  className={`tx-chamber-frame relative w-full rounded-[24px] sm:rounded-[30px] p-[2px] gold-metallic-frame transition-all duration-300 text-center focus-visible:outline-2 focus-visible:outline-amber-300 ${
                    taiWon
                      ? 'animate-win-burst scale-[1.02]'
                      : activeSide === 'TAI' && canBet
                        ? 'ring-2 ring-amber-300'
                        : ''
                  }`}
                >
                  <div
                    className={`tx-chamber-inner relative w-full rounded-[22px] sm:rounded-[28px] bronze-chamber-bg px-3 py-5 sm:py-8 lg:py-12 flex flex-col items-center justify-center text-center overflow-hidden ${
                      taiWon ? 'ring-2 ring-amber-300/80' : ''
                    }`}
                  >
                    {taiWon && (
                      <div
                        className="pointer-events-none absolute inset-0 opacity-45"
                        style={{
                          background:
                            'radial-gradient(circle at 50% 45%, rgba(250, 204, 21, 0.7) 0%, transparent 70%)',
                        }}
                        aria-hidden="true"
                      />
                    )}

                    <h2
                      className={`tx-chamber-title relative font-display text-4xl sm:text-5xl lg:text-7xl font-black tracking-wide transition-all duration-300 ${
                        taiWon ? 'tai-black-win-glow scale-105' : 'tai-black-text'
                      }`}
                    >
                      TÀI
                    </h2>

                    {/* Tổng số tiền cược của tất cả người chơi cửa TÀI */}
                    <div
                      className="tx-total-pot relative mt-2 px-3 py-1 rounded-full bg-black/50 border border-amber-400/45 shadow-inner"
                      title="Tổng số tiền cược của tất cả người chơi bên TÀI"
                    >
                      <span className="font-mono-num text-xs sm:text-base font-bold text-amber-200">
                        {taiPot.toLocaleString('en-US')}
                      </span>
                    </div>
                  </div>
                </button>

                {/* Tiền đặt cược của người chơi (hiển thị ngay bên trên nút ĐẶT CƯỢC) */}
                <div
                  className={`tx-pot-pill w-full max-w-[280px] px-3 py-1.5 rounded-full crimson-pot-bg border text-center transition-colors ${
                    taiPending > 0 ? 'border-yellow-300' : 'border-[#e7c48b]/80'
                  }`}
                  title="Số tiền đặt cược của bạn bên TÀI"
                >
                  <span
                    className={`tx-pot-text font-mono-num text-sm sm:text-lg font-bold tracking-wide ${
                      taiPending > 0
                        ? 'text-yellow-300'
                        : userTaiBet > 0
                          ? 'text-amber-200'
                          : 'text-amber-200/75'
                    }`}
                  >
                    {taiUserDisplay.toLocaleString('en-US')}
                  </span>
                </div>

                {/* TÀI Bet Button */}
                <button
                  type="button"
                  disabled={!canBet || (pendingAmount > 0 && balance < 1000)}
                  onClick={() => handlePlaceBet('TAI')}
                  className="tx-bet-btn w-full max-w-[230px] min-h-[44px] py-2.5 px-5 rounded-full gold-bet-btn border border-[#e7c48b]/85 font-display text-sm sm:text-base font-extrabold tracking-wider text-amber-50 uppercase transition-all active:scale-95 disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-amber-300 whitespace-nowrap"
                >
                  ĐẶT CƯỢC
                </button>
              </div>

              {/* RIGHT ZONE: XỈU */}
              <div className="tx-side-col-right col-span-1 md:col-span-4 md:order-3 flex flex-col items-center gap-2.5 sm:gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (!canBet) return;
                    playClickSound(soundEnabled);
                    setActiveSide('XIU');
                  }}
                  className={`tx-chamber-frame relative w-full rounded-[24px] sm:rounded-[30px] p-[2px] gold-metallic-frame transition-all duration-300 text-center focus-visible:outline-2 focus-visible:outline-amber-300 ${
                    xiuWon
                      ? 'animate-win-burst scale-[1.02]'
                      : activeSide === 'XIU' && canBet
                        ? 'ring-2 ring-amber-300'
                        : ''
                  }`}
                >
                  <div
                    className={`tx-chamber-inner relative w-full rounded-[22px] sm:rounded-[28px] bronze-chamber-bg px-3 py-5 sm:py-8 lg:py-12 flex flex-col items-center justify-center text-center overflow-hidden ${
                      xiuWon ? 'ring-2 ring-amber-300/80' : ''
                    }`}
                  >
                    {xiuWon && (
                      <div
                        className="pointer-events-none absolute inset-0 opacity-45"
                        style={{
                          background:
                            'radial-gradient(circle at 50% 45%, rgba(250, 204, 21, 0.7) 0%, transparent 70%)',
                        }}
                        aria-hidden="true"
                      />
                    )}

                    <h2
                      className={`tx-chamber-title relative font-display text-4xl sm:text-5xl lg:text-7xl font-black tracking-wide transition-all duration-300 ${
                        xiuWon
                          ? 'text-yellow-300 tai-win-glow scale-105'
                          : 'gold-text-gradient drop-shadow-[0_4px_10px_rgba(0,0,0,0.9)]'
                      }`}
                    >
                      XỈU
                    </h2>

                    {/* Tổng số tiền cược của tất cả người chơi cửa XỈU */}
                    <div
                      className="tx-total-pot relative mt-2 px-3 py-1 rounded-full bg-black/50 border border-amber-400/45 shadow-inner"
                      title="Tổng số tiền cược của tất cả người chơi bên XỈU"
                    >
                      <span className="font-mono-num text-xs sm:text-base font-bold text-amber-200">
                        {xiuPot.toLocaleString('en-US')}
                      </span>
                    </div>
                  </div>
                </button>

                {/* Tiền đặt cược của người chơi (hiển thị ngay bên trên nút ĐẶT CƯỢC) */}
                <div
                  className={`tx-pot-pill w-full max-w-[280px] px-3 py-1.5 rounded-full crimson-pot-bg border text-center transition-colors ${
                    xiuPending > 0 ? 'border-yellow-300' : 'border-[#e7c48b]/80'
                  }`}
                  title="Số tiền đặt cược của bạn bên XỈU"
                >
                  <span
                    className={`tx-pot-text font-mono-num text-sm sm:text-lg font-bold tracking-wide ${
                      xiuPending > 0
                        ? 'text-yellow-300'
                        : userXiuBet > 0
                          ? 'text-amber-200'
                          : 'text-amber-200/75'
                    }`}
                  >
                    {xiuUserDisplay.toLocaleString('en-US')}
                  </span>
                </div>

                {/* XỈU Bet Button */}
                <button
                  type="button"
                  disabled={!canBet || (pendingAmount > 0 && balance < 1000)}
                  onClick={() => handlePlaceBet('XIU')}
                  className="tx-bet-btn w-full max-w-[230px] min-h-[44px] py-2.5 px-5 rounded-full gold-bet-btn border border-[#e7c48b]/85 font-display text-sm sm:text-base font-extrabold tracking-wider text-amber-50 uppercase transition-all active:scale-95 disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-amber-300 whitespace-nowrap"
                >
                  ĐẶT CƯỢC
                </button>
              </div>
            </div>

            {/* CHIP SELECTOR STRIP */}
            <div className="tx-controls-strip relative z-10 mt-5 pt-3.5 border-t border-amber-500/25 flex items-center justify-center gap-2">
              <div className="tx-chips-group flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
                {CHIP_OPTIONS.map((chip) => {
                  const active = lastSelectedChip === chip;
                  const disabled = !canBet || balance - pendingAmount < chip;
                  return (
                    <button
                      key={chip}
                      type="button"
                      disabled={disabled}
                      onClick={() => handleSelectChip(chip)}
                      className={`tx-chip-btn min-h-[40px] px-3 sm:px-3.5 py-1.5 rounded-lg font-mono-num text-xs sm:text-sm font-bold transition-all whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-amber-300 ${
                        active
                          ? 'bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 shadow-[0_0_14px_rgba(245,158,11,0.55)] scale-105'
                          : 'bg-black/55 text-amber-200 border border-amber-500/35 hover:border-amber-400/70'
                      }`}
                    >
                      {formatCompactChip(chip)}
                    </button>
                  );
                })}

                <button
                  type="button"
                  disabled={!canBet || balance <= 0 || pendingAmount >= balance}
                  onClick={handleAllIn}
                  className={`tx-chip-btn min-h-[40px] px-3 sm:px-3.5 py-1.5 rounded-lg font-display text-xs sm:text-sm font-black tracking-wide uppercase transition-all whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-amber-300 ${
                    lastSelectedChip === 'ALL_IN' || (pendingAmount === balance && balance > 0)
                      ? 'bg-gradient-to-b from-rose-400 via-red-500 to-rose-700 text-white border border-amber-300 shadow-[0_0_14px_rgba(244,63,94,0.65)] scale-105'
                      : 'bg-gradient-to-b from-rose-900/90 to-rose-950 text-amber-200 border border-rose-400/60 hover:border-amber-300'
                  }`}
                >
                  ALL IN
                </button>

                {(pendingAmount > 0 || userTaiBet > 0 || userXiuBet > 0) && canBet && (
                  <button
                    type="button"
                    onClick={handleClearBets}
                    className="tx-chip-btn min-h-[40px] flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-950/60 border border-rose-400/45 text-xs font-semibold text-rose-200 hover:bg-rose-900/60 transition-colors whitespace-nowrap"
                    title="Hoàn lại Xu đã chọn trong phiên này"
                  >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Hủy</span>
                  </button>
                )}
              </div>
            </div>

            {/* BOTTOM HISTORY BEAD RAIL (Lịch sử các phiên trước) */}
            <div className="tx-history-section relative z-10 mt-3.5">
              <div className="tx-history-meta flex items-center justify-between text-xs text-amber-200/75 px-1 mb-1.5">
                <span className="font-medium">
                  Lịch sử phiên trước · Đen: Tài (11–18) · Trắng: Xỉu (3–10)
                </span>
                {inspectedRound && (
                  <span className="font-mono-num text-amber-300 font-semibold">
                    #{inspectedRound.sessionId}: {inspectedRound.dice.join('-')} ={' '}
                    {inspectedRound.total} ({inspectedRound.outcome === 'TAI' ? 'TÀI' : 'XỈU'})
                  </span>
                )}
              </div>

              <div className="p-[2px] rounded-full gold-metallic-frame shadow-inner">
                <div className="tx-bead-rail px-3 sm:px-5 py-2 rounded-full bg-gradient-to-b from-[#2f1a09] to-[#120702] flex items-center justify-between gap-1.5 sm:gap-2 overflow-x-auto shadow-[inset_0_3px_10px_rgba(0,0,0,0.85)]">
                  {recentBeads.map((item, idx) => {
                    const isLatest = idx === recentBeads.length - 1;
                    const isSelected = inspectedRound?.sessionId === item.sessionId;
                    const isTai = item.outcome === 'TAI';

                    return (
                      <button
                        key={item.sessionId}
                        type="button"
                        onClick={() => {
                          playClickSound(soundEnabled);
                          setInspectedRound(
                            inspectedRound?.sessionId === item.sessionId ? null : item
                          );
                        }}
                        title={`Phiên #${item.sessionId}: ${item.dice.join(' + ')} = ${item.total} (${isTai ? 'TÀI' : 'XỈU'})`}
                        style={{
                          background: isTai
                            ? 'radial-gradient(circle at 32% 28%, #4b4b52 0%, #17171a 46%, #030304 100%)'
                            : 'radial-gradient(circle at 32% 28%, #ffffff 0%, #f3efe6 55%, #cfc5b4 100%)',
                        }}
                        className={`tx-bead-item shrink-0 flex items-center justify-center rounded-full font-mono-num font-extrabold transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-amber-300 shadow-[0_3px_6px_rgba(0,0,0,0.75)] ${
                          isLatest
                            ? 'tx-bead-item-latest w-8 h-8 sm:w-9 sm:h-9 text-xs sm:text-sm ring-2 ring-yellow-300 shadow-[0_0_14px_rgba(250,204,21,0.9)]'
                            : 'w-7 h-7 sm:w-8 sm:h-8 text-[11px]'
                        } ${
                          isSelected ? 'ring-2 ring-sky-300 scale-110' : ''
                        } ${
                          isTai
                            ? 'text-amber-200 border border-amber-400/70'
                            : 'text-zinc-950 border border-amber-200/85'
                        }`}
                      >
                        {item.total}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Bottom RÚT TIỀN Action Bar (matching top TÀI XỈU title scale) */}
        <footer className="tx-footer flex items-center justify-center px-2">
          <button
            type="button"
            onClick={() => {
              playClickSound(soundEnabled);
              setActiveModal('withdraw');
            }}
            className="p-[2px] rounded-2xl gold-metallic-frame shadow-[0_8px_28px_rgba(0,0,0,0.9)] hover:brightness-110 active:scale-[0.98] transition-all focus-visible:outline-2 focus-visible:outline-amber-300"
          >
            <span className="tx-withdraw-btn flex items-center justify-center px-8 sm:px-14 py-1.5 sm:py-2 rounded-[14px] bg-gradient-to-b from-[#492c13] via-[#271306] to-[#120702]">
              <span className="tx-withdraw-title font-rounded text-4xl sm:text-5xl lg:text-[54px] font-black tracking-wide gold-text-gradient drop-shadow-[0_4px_14px_rgba(0,0,0,0.95)] leading-none whitespace-nowrap">
                RÚT TIỀN
              </span>
            </span>
          </button>
        </footer>
      </main>

      {/* Modals */}
      {activeModal === 'rules' && <RulesModal onClose={() => setActiveModal(null)} />}
      {activeModal === 'stats' && (
        <StatsModal history={history} onClose={() => setActiveModal(null)} />
      )}
      {activeModal === 'history' && (
        <HistoryModal history={history} onClose={() => setActiveModal(null)} />
      )}
      {activeModal === 'deposit' && (
        <DepositModal
          sessionId={sessionId}
          onConfirmDeposit={(amount) => {
            playClickSound(soundEnabled);
            void syncDepositAmount(amount);
          }}
          onClose={() => setActiveModal(null)}
        />
      )}
      {activeModal === 'withdraw' && (
        <WithdrawModal
          balance={balance}
          withdrawHistory={withdrawHistory}
          onConfirmWithdraw={(record) => {
            playClickSound(soundEnabled);
            const token = getActiveAuthToken();
            if (token) {
              void fetch('/api/player/withdraw', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ amount: record.amount }),
              })
                .then((res) => (res.ok ? res.json() : null))
                .then((data: { balance?: number } | null) => {
                  if (data && typeof data.balance === 'number') {
                    setBalance(data.balance);
                  }
                })
                .catch(() => {});
            } else {
              setBalance((b) => Math.max(0, b - record.amount));
            }
            setWithdrawHistory((prev) => [
              {
                ...record,
                id: `wd-${Date.now()}`,
                timestamp: Date.now(),
              },
              ...prev,
            ]);
          }}
          onClose={() => setActiveModal(null)}
        />
      )}
      {/* Small Players List Box for Website Owner (Chủ Web) */}
      {currentUser.isOwner && (
        <OwnerPlayersBox ownerToken={ownerToken} livePlayers={livePlayers} />
      )}

      {/* Background YouTube Music Player (SVJ-_Kcihz8) */}
      <BackgroundMusic enabled={bgmEnabled} soundEnabled={soundEnabled} />
    </div>
  );
}
