import React, { useState } from 'react';
import { X, Eye, EyeOff, UserPlus, LogIn, KeyRound, Crown } from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../firebase';
import { RedDice } from './RedDice';

export interface UserAccount {
  uid?: string;
  username: string;
  password: string;
  displayName: string;
  balance: number;
  isOwner?: boolean;
  authSource?: 'account' | 'google' | 'owner';
}

const ACCOUNTS_STORAGE_KEY = 'tx_accounts_v1';
const OWNER_STORAGE_KEY = 'tx_owner_account_v1';
export const OWNER_SESSION_KEY = '__owner__';
export const PLAYER_TOKEN_STORAGE_KEY = 'tx_player_token_v1';
export const OWNER_TOKEN_STORAGE_KEY = 'tx_owner_token_v1';
const INITIAL_BONUS_BALANCE = 100000000;
const INITIAL_OWNER_BALANCE = 1000000000;

export function loadAccounts(): Record<string, UserAccount> {
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveAccounts(accounts: Record<string, UserAccount>): void {
  try {
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadOwnerAccount(): UserAccount {
  const fallback: UserAccount = {
    username: OWNER_SESSION_KEY,
    password: '',
    displayName: 'Chủ Web',
    balance: INITIAL_OWNER_BALANCE,
    isOwner: true,
    authSource: 'owner',
  };
  try {
    const raw = localStorage.getItem(OWNER_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      return {
        ...fallback,
        ...parsed,
        username: OWNER_SESSION_KEY,
        isOwner: true,
        authSource: 'owner',
      };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function saveOwnerAccount(account: UserAccount): void {
  try {
    localStorage.setItem(
      OWNER_STORAGE_KEY,
      JSON.stringify({
        ...account,
        username: OWNER_SESSION_KEY,
        isOwner: true,
        authSource: 'owner',
      }),
    );
  } catch {
    // Ignore storage quota errors
  }
}

interface AuthGatewayProps {
  onAuthSuccess: (account: UserAccount) => void;
  onPlaySound?: () => void;
}

export const AuthGateway: React.FC<AuthGatewayProps> = ({ onAuthSuccess, onPlaySound }) => {
  // null = initial lobby screen with 2 choices (ĐĂNG KÝ / ĐĂNG NHẬP)
  const [mode, setMode] = useState<'register' | 'login' | 'owner' | null>(null);

  // Register form state
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [regDisplayName, setRegDisplayName] = useState('');
  const [showRegPass, setShowRegPass] = useState(false);
  const [showRegConfirm, setShowRegConfirm] = useState(false);

  // Login form state
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPass, setShowLoginPass] = useState(false);

  // Owner key form state
  const [ownerPassword, setOwnerPassword] = useState('');
  const [showOwnerPass, setShowOwnerPass] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openMode = (nextMode: 'register' | 'login' | 'owner') => {
    onPlaySound?.();
    setError(null);
    if (nextMode === 'owner') {
      setOwnerPassword('');
      setShowOwnerPass(false);
    }
    setMode(nextMode);
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);
    onPlaySound?.();

    const username = regUsername.trim();
    const key = username.toLowerCase();
    const password = regPassword;
    const confirm = regConfirm;
    const displayName = (regDisplayName.trim() || username).slice(0, 16);

    if (username.length < 3 || username.length > 24) {
      setError('Tên Đăng Nhập phải từ 3 đến 24 ký tự.');
      return;
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
      setError('Tên Đăng Nhập chỉ gồm chữ cái, số hoặc dấu _ . - (không khoảng trắng).');
      return;
    }
    if (password.length < 4) {
      setError('Mật Khẩu phải có ít nhất 4 ký tự.');
      return;
    }
    if (password !== confirm) {
      setError('Xác nhận mật khẩu chưa khớp.');
      return;
    }
    if (key === OWNER_SESSION_KEY) {
      setError('Tên Đăng Nhập này đã tồn tại, vui lòng chọn tên khác.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, displayName }),
      });
      const data = (await res.json()) as {
        error?: string;
        token?: string;
        player?: { username: string; displayName: string; balance: number };
      };

      if (!res.ok || !data.player) {
        setError(data.error || 'Không thể đăng ký tài khoản.');
        return;
      }

      if (data.token) {
        localStorage.setItem(PLAYER_TOKEN_STORAGE_KEY, data.token);
      }

      const newAccount: UserAccount = {
        username: data.player.username,
        password: '',
        displayName: data.player.displayName,
        balance: data.player.balance,
        authSource: 'account',
      };
      const accounts = loadAccounts();
      accounts[key] = newAccount;
      saveAccounts(accounts);
      onAuthSuccess(newAccount);
    } catch {
      setError('Không thể kết nối máy chủ. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);
    onPlaySound?.();

    const username = loginUsername.trim();
    const key = username.toLowerCase();

    if (!username || !loginPassword) {
      setError('Vui lòng nhập đầy đủ Tên Đăng Nhập và Mật Khẩu.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: loginPassword }),
      });
      const data = (await res.json()) as {
        error?: string;
        token?: string;
        player?: { username: string; displayName: string; balance: number };
      };

      if (res.ok && data.player) {
        if (data.token) {
          localStorage.setItem(PLAYER_TOKEN_STORAGE_KEY, data.token);
        }
        const account: UserAccount = {
          username: data.player.username,
          password: '',
          displayName: data.player.displayName,
          balance: data.player.balance,
          authSource: 'account',
        };
        const accounts = loadAccounts();
        accounts[key] = account;
        saveAccounts(accounts);
        onAuthSuccess(account);
        return;
      }

      // Migrate legacy local-only accounts created before server sync if password matches locally
      if (res.status === 404) {
        const localAccounts = loadAccounts();
        const legacy = localAccounts[key];
        if (legacy && legacy.password === loginPassword) {
          const migrateRes = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: legacy.username,
              password: loginPassword,
              displayName: legacy.displayName,
            }),
          });
          const migrateData = (await migrateRes.json()) as {
            token?: string;
            player?: { username: string; displayName: string; balance: number };
          };
          if (migrateRes.ok && migrateData.player) {
            if (migrateData.token) {
              localStorage.setItem(PLAYER_TOKEN_STORAGE_KEY, migrateData.token);
            }
            const account: UserAccount = {
              username: migrateData.player.username,
              password: '',
              displayName: legacy.displayName,
              balance: legacy.balance,
              authSource: 'account',
            };
            onAuthSuccess(account);
            return;
          }
        }
      }

      setError(data.error || 'Đăng nhập thất bại.');
    } catch {
      setError('Không thể kết nối máy chủ. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (isSubmitting) return;
    setError(null);
    onPlaySound?.();
    setIsSubmitting(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const user = cred.user;
      const uid = user.uid;
      const rawPrefix = (user.email?.split('@')[0] || `player_${uid.slice(0, 6)}`)
        .replace(/[^a-zA-Z0-9_.-]/g, '_')
        .slice(0, 24);
      const cleanUsername = rawPrefix.length >= 2 ? rawPrefix : `p_${uid.slice(0, 8)}`;
      const cleanDisplayName = (user.displayName || cleanUsername).trim().slice(0, 16) || cleanUsername;

      const playerRef = doc(db, 'players', uid);
      let finalBalance = INITIAL_BONUS_BALANCE;
      let finalDisplayName = cleanDisplayName;
      let finalUsername = cleanUsername;

      try {
        const snap = await getDoc(playerRef);
        if (snap.exists()) {
          const existing = snap.data();
          finalBalance = typeof existing.balance === 'number' ? existing.balance : INITIAL_BONUS_BALANCE;
          finalDisplayName =
            typeof existing.displayName === 'string' && existing.displayName.trim()
              ? existing.displayName.trim().slice(0, 16)
              : cleanDisplayName;
          finalUsername =
            typeof existing.username === 'string' && existing.username.trim()
              ? existing.username.trim().slice(0, 32)
              : cleanUsername;

          await updateDoc(playerRef, {
            displayName: finalDisplayName,
            balance: finalBalance,
            isOnline: true,
            lastLoginAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(playerRef, {
            uid,
            username: finalUsername,
            displayName: finalDisplayName,
            balance: finalBalance,
            role: 'player',
            isOnline: true,
            authSource: 'google',
            createdAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (fsErr) {
        handleFirestoreError(fsErr, OperationType.WRITE, `players/${uid}`);
      }

      try {
        const syncRes = await fetch('/api/players/google-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid,
            username: finalUsername,
            displayName: finalDisplayName,
            balance: finalBalance,
          }),
        });
        if (syncRes.ok) {
          const syncData = (await syncRes.json()) as { token?: string };
          if (syncData.token) {
            localStorage.setItem(PLAYER_TOKEN_STORAGE_KEY, syncData.token);
          }
        }
      } catch {
        // Ignore if server sync temporarily fails
      }

      const account: UserAccount = {
        uid,
        username: finalUsername,
        password: '',
        displayName: finalDisplayName,
        balance: finalBalance,
        authSource: 'google',
      };
      onAuthSuccess(account);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể đăng nhập bằng Google.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOwnerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);
    onPlaySound?.();

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/owner/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ownerPassword }),
      });
      const data = (await res.json()) as { error?: string; ownerToken?: string };

      if (!res.ok || !data.ownerToken) {
        setError(data.error || 'Mật khẩu chìa khóa không chính xác.');
        return;
      }

      localStorage.setItem(OWNER_TOKEN_STORAGE_KEY, data.ownerToken);
      const ownerAccount = loadOwnerAccount();
      saveOwnerAccount(ownerAccount);
      onAuthSuccess(ownerAccount);
    } catch {
      setError('Không thể xác thực Chủ Web với máy chủ.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-dvh w-full flex flex-col items-center justify-center p-4 relative overflow-hidden select-none"
      style={{
        background:
          'radial-gradient(ellipse at 50% 38%, #341a0d 0%, #190a12 52%, #070306 100%)',
      }}
    >
      {/* Warm gold ambient spotlight */}
      <div
        className="pointer-events-none fixed inset-0 opacity-50"
        style={{
          background:
            'radial-gradient(circle at 50% 42%, rgba(235, 175, 65, 0.25) 0%, transparent 60%)',
        }}
        aria-hidden="true"
      />

      {/* Owner Key Button (Chìa khóa Chủ Web) */}
      <button
        type="button"
        onClick={() => openMode('owner')}
        aria-label="Chìa khóa Chủ Web"
        title="Chìa khóa Chủ Web"
        className="fixed top-3 right-3 sm:top-5 sm:right-5 z-20 w-11 h-11 sm:w-12 sm:h-12 rounded-full p-[2px] gold-metallic-frame shadow-[0_8px_24px_rgba(0,0,0,0.85)] hover:scale-105 active:scale-95 transition-transform focus-visible:outline-2 focus-visible:outline-amber-300"
      >
        <span className="flex items-center justify-center w-full h-full rounded-full bg-gradient-to-b from-[#3b200c] to-[#120702] text-amber-300">
          <KeyRound className="w-5 h-5" aria-hidden="true" />
        </span>
      </button>

      {/* Initial 2-Choice Lobby Screen (shown when mode === null) */}
      <div className="relative z-10 w-full max-w-[540px] flex flex-col items-center text-center gap-5 sm:gap-7">
        {/* Royal Branding Header */}
        <div className="flex flex-col items-center">
          <h1 className="font-rounded text-5xl sm:text-6xl font-black tracking-wide gold-text-gradient drop-shadow-[0_6px_18px_rgba(0,0,0,0.95)] leading-none">
            TÀI XỈU
          </h1>
          <p
            className="font-rounded text-xl sm:text-3xl font-black tracking-wide bg-gradient-to-b from-[#dcfce7] via-[#4ade80] to-[#15803d] bg-clip-text text-transparent mt-2.5 leading-snug"
            style={{
              filter:
                'drop-shadow(0 0 14px rgba(74, 222, 128, 0.55)) drop-shadow(0 4px 10px rgba(0, 0, 0, 0.95))',
            }}
          >
            Nhà cái đến từ thôn TRÙM
          </p>
        </div>

        {/* Ornamental 3-Red-Dice Centerpiece */}
        <div className="p-[4px] rounded-full gold-bezel-ring shadow-[0_18px_50px_rgba(0,0,0,0.9)]">
          <div
            className="w-[186px] h-[186px] sm:w-[216px] sm:h-[216px] rounded-full border-2 border-amber-200/35 flex flex-col items-center justify-center relative overflow-hidden"
            style={{
              background:
                'radial-gradient(circle at 50% 42%, #291b12 0%, #0e0805 64%, #050202 100%)',
              boxShadow: 'inset 0 12px 30px rgba(0, 0, 0, 0.95)',
            }}
          >
            <div className="mb-1.5">
              <RedDice value={5} isRolling={false} variant="a" size="md" />
            </div>
            <div className="flex items-center gap-4">
              <RedDice value={4} isRolling={false} variant="b" size="md" />
              <RedDice value={2} isRolling={false} variant="c" size="md" />
            </div>
          </div>
        </div>

        {/* Lobby Card with 2 Primary Choices: ĐĂNG KÝ & ĐĂNG NHẬP */}
        <div className="w-full rounded-[28px] p-[2px] gold-metallic-frame shadow-[0_20px_60px_rgba(0,0,0,0.95)]">
          <div className="rounded-[26px] bg-gradient-to-b from-[#251026] via-[#170917] to-[#120704] px-5 py-6 sm:px-8 sm:py-7 space-y-5">
            <div className="space-y-1">
              <h2 className="font-rounded text-lg sm:text-xl font-extrabold text-amber-100">
                Chào Mừng Đến Với Sảnh Cược
              </h2>
              <p className="text-xs sm:text-sm text-amber-200/75">
                Chọn Đăng Ký tài khoản mới hoặc Đăng Nhập để vào bàn chơi
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Button 1: ĐĂNG KÝ */}
              <button
                type="button"
                onClick={() => openMode('register')}
                className="relative overflow-hidden min-h-[52px] px-6 py-3 rounded-full border-2 border-[#e5a8f7]/80 bg-gradient-to-b from-[#9d2bb8] via-[#6e1286] to-[#3f054f] font-display text-base font-black tracking-wider text-white uppercase shadow-[0_8px_24px_rgba(147,51,234,0.45),inset_0_2px_6px_rgba(255,255,255,0.35)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-amber-300"
              >
                <span
                  className="pointer-events-none absolute inset-x-4 top-0.5 h-[42%] rounded-full bg-gradient-to-b from-white/35 to-transparent"
                  aria-hidden="true"
                />
                <UserPlus className="relative z-10 w-5 h-5" aria-hidden="true" />
                <span className="relative z-10">ĐĂNG KÝ</span>
              </button>

              {/* Button 2: ĐĂNG NHẬP */}
              <button
                type="button"
                onClick={() => openMode('login')}
                className="relative overflow-hidden min-h-[52px] px-6 py-3 rounded-full border-2 border-[#f4d793] bg-gradient-to-b from-[#c79541] via-[#8b5a19] to-[#5d3609] font-display text-base font-black tracking-wider text-amber-50 uppercase shadow-[0_8px_24px_rgba(245,158,11,0.38),inset_0_2px_6px_rgba(255,244,200,0.4)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-amber-300"
              >
                <span
                  className="pointer-events-none absolute inset-x-4 top-0.5 h-[42%] rounded-full bg-gradient-to-b from-white/35 to-transparent"
                  aria-hidden="true"
                />
                <LogIn className="relative z-10 w-5 h-5" aria-hidden="true" />
                <span className="relative z-10">ĐĂNG NHẬP</span>
              </button>
            </div>

            <div className="pt-1 border-t border-amber-500/20 flex flex-col items-center gap-2">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleGoogleSignIn()}
                className="w-full sm:w-auto min-h-[42px] px-5 py-2 rounded-full border border-amber-400/50 bg-black/50 text-xs sm:text-sm font-bold text-amber-100 hover:bg-amber-500/15 hover:border-amber-300 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white text-[#4285F4] font-black text-xs">
                  G
                </span>
                <span>{isSubmitting ? 'Đang kết nối...' : 'Đăng nhập nhanh bằng Google'}</span>
              </button>
              {mode === null && error && (
                <p className="text-xs font-semibold text-rose-400">{error}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal Overlay matching the two reference screenshots */}
      {mode !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4"
          onClick={() => setMode(null)}
          role="dialog"
          aria-modal="true"
          aria-label={
            mode === 'register'
              ? 'Đăng ký tài khoản'
              : mode === 'owner'
                ? 'Chìa khóa Chủ Web'
                : 'Đăng nhập tài khoản'
          }
        >
          <div
            className="tx-modal-box relative w-full max-w-[520px] rounded-[22px] border-2 border-[#d6b98d]/85 bg-gradient-to-b from-[#1a0522] via-[#120417] to-[#1e0e08] shadow-[0_26px_70px_rgba(0,0,0,0.95)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Subtle diagonal sheen texture matching reference */}
            <div
              className="pointer-events-none absolute inset-0 opacity-20"
              style={{
                background:
                  'linear-gradient(125deg, transparent 25%, rgba(212, 162, 89, 0.25) 45%, transparent 65%)',
              }}
              aria-hidden="true"
            />

            {/* Top Header Band with Trapezoidal Gold Crest & Top-Right X Close */}
            <div className="relative flex items-start justify-center pt-0 pb-2 px-4">
              {/* Trapezoidal Crest Plaque */}
              <div
                className="p-[2px] shadow-[0_6px_18px_rgba(0,0,0,0.85)]"
                style={{
                  background: 'linear-gradient(180deg, #fae9bf 0%, #c89548 100%)',
                  clipPath: 'polygon(0 0, 100% 0, 88% 100%, 12% 100%)',
                }}
              >
                <div
                  className="px-10 sm:px-14 py-2 sm:py-2.5 text-center"
                  style={{
                    background:
                      'linear-gradient(180deg, #8b5c2d 0%, #9b6a38 42%, #3f1833 88%, #2a0c22 100%)',
                    clipPath: 'polygon(0 0, 100% 0, 88% 100%, 12% 100%)',
                  }}
                >
                  <h2 className="font-display text-lg sm:text-xl font-black tracking-wide text-[#fef0c7] drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] uppercase whitespace-nowrap">
                    {mode === 'register'
                      ? 'ĐĂNG KÝ'
                      : mode === 'owner'
                        ? 'CHỦ WEB'
                        : 'ĐĂNG NHẬP'}
                  </h2>
                </div>
              </div>

              {/* Top-Right Close X Ear */}
              <button
                type="button"
                onClick={() => setMode(null)}
                aria-label="Đóng"
                className="absolute right-0 top-0 flex items-center justify-center w-11 h-10 rounded-bl-2xl border-l-2 border-b-2 border-[#e7c78f] bg-gradient-to-b from-[#4d280f] to-[#1a0a03] text-[#f9e1a3] hover:brightness-115 active:scale-95 transition-all shadow-lg"
              >
                <X className="w-5 h-5 stroke-[2.6]" />
              </button>
            </div>

            {/* Modal Form Content */}
            <div className="relative z-10 px-5 sm:px-9 pt-4 pb-6 max-h-[82dvh] overflow-y-auto">
              {mode === 'register' ? (
                <form onSubmit={handleRegisterSubmit} className="space-y-4">
                  {/* Field 1: * Tên Đăng Nhập */}
                  <div className="flex items-center gap-3">
                    <span className="text-xl font-bold text-[#f3dfb6] w-3 text-center shrink-0" aria-hidden="true">
                      *
                    </span>
                    <input
                      type="text"
                      value={regUsername}
                      onChange={(e) => {
                        setRegUsername(e.target.value);
                        setError(null);
                      }}
                      placeholder="Tên Đăng Nhập"
                      autoComplete="username"
                      autoFocus
                      maxLength={24}
                      className="w-full h-11 sm:h-12 px-5 rounded-full bg-[#13030c] border border-[#d6b98d]/85 text-sm sm:text-base text-amber-50 placeholder:text-stone-400/80 outline-none focus:border-amber-300 shadow-[inset_0_2px_8px_rgba(0,0,0,0.9)]"
                    />
                  </div>

                  {/* Field 2: * Mật Khẩu */}
                  <div className="flex items-center gap-3">
                    <span className="text-xl font-bold text-[#f3dfb6] w-3 text-center shrink-0" aria-hidden="true">
                      *
                    </span>
                    <div className="relative w-full">
                      <input
                        type={showRegPass ? 'text' : 'password'}
                        value={regPassword}
                        onChange={(e) => {
                          setRegPassword(e.target.value);
                          setError(null);
                        }}
                        placeholder="Mật Khẩu"
                        autoComplete="new-password"
                        className="w-full h-11 sm:h-12 pl-5 pr-11 rounded-full bg-[#13030c] border border-[#d6b98d]/85 text-sm sm:text-base text-amber-50 placeholder:text-stone-400/80 outline-none focus:border-amber-300 shadow-[inset_0_2px_8px_rgba(0,0,0,0.9)]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegPass((v) => !v)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-amber-200/60 hover:text-amber-200 p-1"
                        aria-label={showRegPass ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                      >
                        {showRegPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Field 3: * Xác nhận mật khẩu */}
                  <div className="flex items-center gap-3">
                    <span className="text-xl font-bold text-[#f3dfb6] w-3 text-center shrink-0" aria-hidden="true">
                      *
                    </span>
                    <div className="relative w-full">
                      <input
                        type={showRegConfirm ? 'text' : 'password'}
                        value={regConfirm}
                        onChange={(e) => {
                          setRegConfirm(e.target.value);
                          setError(null);
                        }}
                        placeholder="Xác nhận mật khẩu"
                        autoComplete="new-password"
                        className="w-full h-11 sm:h-12 pl-5 pr-11 rounded-full bg-[#13030c] border border-[#d6b98d]/85 text-sm sm:text-base text-amber-50 placeholder:text-stone-400/80 outline-none focus:border-amber-300 shadow-[inset_0_2px_8px_rgba(0,0,0,0.9)]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegConfirm((v) => !v)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-amber-200/60 hover:text-amber-200 p-1"
                        aria-label={showRegConfirm ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                      >
                        {showRegConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Field 4: Tên Hiển Thị */}
                  <div className="flex items-center gap-3">
                    <span className="w-3 shrink-0" aria-hidden="true" />
                    <input
                      type="text"
                      value={regDisplayName}
                      onChange={(e) => {
                        setRegDisplayName(e.target.value);
                        setError(null);
                      }}
                      placeholder="Tên Hiển Thị"
                      maxLength={16}
                      className="w-full h-11 sm:h-12 px-5 rounded-full bg-[#13030c] border border-[#d6b98d]/85 text-sm sm:text-base text-amber-50 placeholder:text-stone-400/80 outline-none focus:border-amber-300 shadow-[inset_0_2px_8px_rgba(0,0,0,0.9)]"
                    />
                  </div>

                  {error && (
                    <p className="text-center text-xs sm:text-sm font-semibold text-rose-400 pt-1">
                      {error}
                    </p>
                  )}

                  {/* Glossy Purple-Magenta ĐĂNG KÝ Button matching reference */}
                  <div className="pt-2 flex flex-col items-center gap-3">
                    <button
                      type="submit"
                      className="relative overflow-hidden min-h-[48px] min-w-[200px] sm:min-w-[220px] px-8 py-2.5 rounded-full border-2 border-[#efb6ff]/85 bg-gradient-to-b from-[#a831c7] via-[#71128c] to-[#3f0451] font-display text-base font-extrabold tracking-wider text-white uppercase shadow-[0_8px_24px_rgba(168,85,247,0.45),inset_0_2px_6px_rgba(255,255,255,0.4)] hover:brightness-110 active:scale-95 transition-all"
                    >
                      <span
                        className="pointer-events-none absolute inset-x-4 top-0.5 h-[44%] rounded-full bg-gradient-to-b from-white/40 to-transparent"
                        aria-hidden="true"
                      />
                      <span className="relative z-10">ĐĂNG KÝ</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openMode('login')}
                      className="text-xs sm:text-sm text-amber-200/80 hover:text-amber-300 underline-offset-4 hover:underline transition-colors"
                    >
                      Đã có tài khoản? Chuyển sang Đăng Nhập
                    </button>
                  </div>
                </form>
              ) : mode === 'login' ? (
                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  {/* Field 1: Tên Đăng Nhập */}
                  <input
                    type="text"
                    value={loginUsername}
                    onChange={(e) => {
                      setLoginUsername(e.target.value);
                      setError(null);
                    }}
                    placeholder="Tên Đăng Nhập"
                    autoComplete="username"
                    autoFocus
                    className="w-full h-11 sm:h-12 px-5 rounded-full bg-[#13030c] border border-[#d6b98d]/85 text-sm sm:text-base text-amber-50 placeholder:text-stone-400/80 outline-none focus:border-amber-300 shadow-[inset_0_2px_8px_rgba(0,0,0,0.9)]"
                  />

                  {/* Field 2: Mật Khẩu */}
                  <div className="relative w-full">
                    <input
                      type={showLoginPass ? 'text' : 'password'}
                      value={loginPassword}
                      onChange={(e) => {
                        setLoginPassword(e.target.value);
                        setError(null);
                      }}
                      placeholder="Mật Khẩu"
                      autoComplete="current-password"
                      className="w-full h-11 sm:h-12 pl-5 pr-11 rounded-full bg-[#13030c] border border-[#d6b98d]/85 text-sm sm:text-base text-amber-50 placeholder:text-stone-400/80 outline-none focus:border-amber-300 shadow-[inset_0_2px_8px_rgba(0,0,0,0.9)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPass((v) => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-amber-200/60 hover:text-amber-200 p-1"
                      aria-label={showLoginPass ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    >
                      {showLoginPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {error && (
                    <p className="text-center text-xs sm:text-sm font-semibold text-rose-400">
                      {error}
                    </p>
                  )}

                  {/* Centered Gold ĐĂNG NHẬP Button (No "Quên mật khẩu?") */}
                  <div className="pt-2 flex flex-col items-center gap-3">
                    <button
                      type="submit"
                      className="relative overflow-hidden min-h-[48px] min-w-[200px] sm:min-w-[220px] px-8 py-2.5 rounded-full border-2 border-[#f4d793] bg-gradient-to-b from-[#c79541] via-[#8b5a19] to-[#5d3609] font-display text-base font-extrabold tracking-wider text-amber-50 uppercase shadow-[0_8px_24px_rgba(245,158,11,0.4),inset_0_2px_6px_rgba(255,244,200,0.4)] hover:brightness-110 active:scale-95 transition-all"
                    >
                      <span
                        className="pointer-events-none absolute inset-x-4 top-0.5 h-[44%] rounded-full bg-gradient-to-b from-white/35 to-transparent"
                        aria-hidden="true"
                      />
                      <span className="relative z-10">ĐĂNG NHẬP</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openMode('register')}
                      className="text-xs sm:text-sm text-amber-200/80 hover:text-amber-300 underline-offset-4 hover:underline transition-colors"
                    >
                      Chưa có tài khoản? Đăng ký ngay
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleOwnerSubmit} className="space-y-4">
                  <div className="flex flex-col items-center text-center gap-2 pb-1">
                    <span className="flex items-center justify-center w-12 h-12 rounded-full p-[2px] gold-metallic-frame shadow-lg">
                      <span className="flex items-center justify-center w-full h-full rounded-full bg-gradient-to-b from-[#3d210b] to-[#120602] text-amber-300">
                        <Crown className="w-6 h-6" aria-hidden="true" />
                      </span>
                    </span>
                    <p className="text-xs sm:text-sm text-amber-200/85">
                      Nhập mật khẩu chìa khóa để vào thẳng hệ thống với quyền Chủ Web
                    </p>
                  </div>

                  <div className="relative w-full">
                    <input
                      type={showOwnerPass ? 'text' : 'password'}
                      value={ownerPassword}
                      onChange={(e) => {
                        setOwnerPassword(e.target.value);
                        setError(null);
                      }}
                      placeholder="Nhập mật khẩu chìa khóa"
                      autoComplete="off"
                      autoFocus
                      className="w-full h-11 sm:h-12 pl-5 pr-11 rounded-full bg-[#13030c] border border-[#d6b98d]/85 text-sm sm:text-base text-amber-50 placeholder:text-stone-400/80 outline-none focus:border-amber-300 shadow-[inset_0_2px_8px_rgba(0,0,0,0.9)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowOwnerPass((v) => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-amber-200/60 hover:text-amber-200 p-1"
                      aria-label={showOwnerPass ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    >
                      {showOwnerPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {error && (
                    <p className="text-center text-xs sm:text-sm font-semibold text-rose-400">
                      {error}
                    </p>
                  )}

                  <div className="pt-2 flex flex-col items-center">
                    <button
                      type="submit"
                      className="relative overflow-hidden min-h-[48px] min-w-[210px] sm:min-w-[230px] px-8 py-2.5 rounded-full border-2 border-[#f4d793] bg-gradient-to-b from-[#c79541] via-[#8b5a19] to-[#5d3609] font-display text-base font-extrabold tracking-wider text-amber-50 uppercase shadow-[0_8px_24px_rgba(245,158,11,0.4),inset_0_2px_6px_rgba(255,244,200,0.4)] hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                      <span
                        className="pointer-events-none absolute inset-x-4 top-0.5 h-[44%] rounded-full bg-gradient-to-b from-white/35 to-transparent"
                        aria-hidden="true"
                      />
                      <KeyRound className="relative z-10 w-4 h-4" aria-hidden="true" />
                      <span className="relative z-10">MỞ KHÓA</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
