import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Cloud,
  Crown,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Users,
  X,
} from 'lucide-react';
import { onAuthStateChanged, signInWithPopup, User as FirebaseUser } from 'firebase/auth';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  OWNER_ADMIN_EMAIL,
} from '../firebase';

export interface TrackedPlayer {
  id: string;
  username: string;
  displayName: string;
  balance: number;
  authSource: 'account' | 'google';
  isOnline: boolean;
  createdAt: number;
  lastLoginAt: number;
}

interface OwnerPlayersBoxProps {
  ownerToken: string | null;
  livePlayers?: TrackedPlayer[] | null;
}

function formatLoginTime(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return '--:--';
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      hour12: false,
    }).format(new Date(ts));
  } catch {
    return '--:--';
  }
}

function toMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && 'toMillis' in value && typeof (value as { toMillis: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

export const OwnerPlayersBox: React.FC<OwnerPlayersBoxProps> = ({ ownerToken, livePlayers }) => {
  const [serverPlayers, setServerPlayers] = useState<TrackedPlayer[]>([]);
  const [cloudPlayers, setCloudPlayers] = useState<TrackedPlayer[]>([]);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(() => auth.currentUser);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isExpandedModal, setIsExpandedModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [cloudSyncError, setCloudSyncError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Track Firebase auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setCloudSyncError(null);
    });
    return () => unsub();
  }, []);

  const isCloudAdmin =
    Boolean(firebaseUser?.emailVerified) &&
    firebaseUser?.email?.toLowerCase() === OWNER_ADMIN_EMAIL.toLowerCase();

  // Real-time Firestore listener when Owner connects verified Google admin account
  useEffect(() => {
    if (!isCloudAdmin) {
      setCloudPlayers([]);
      return;
    }

    const q = query(collection(db, 'players'), orderBy('lastLoginAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: TrackedPlayer[] = snapshot.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: `gg:${String(d.uid || docSnap.id)}`,
            username: String(d.username || ''),
            displayName: String(d.displayName || d.username || 'Người chơi'),
            balance: typeof d.balance === 'number' ? d.balance : 0,
            authSource: 'google',
            isOnline: Boolean(d.isOnline),
            createdAt: toMillis(d.createdAt),
            lastLoginAt: toMillis(d.lastLoginAt),
          };
        });
        setCloudPlayers(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'players');
      },
    );

    return () => unsub();
  }, [isCloudAdmin]);

  const fetchServerPlayers = useCallback(async () => {
    if (!ownerToken) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/owner/players', {
        headers: {
          Authorization: `Bearer ${ownerToken}`,
        },
      });
      if (res.ok) {
        const data = (await res.json()) as { players?: TrackedPlayer[] };
        if (Array.isArray(data.players)) {
          setServerPlayers(data.players);
        }
      }
    } catch {
      // Ignore transient network errors
    } finally {
      setIsLoading(false);
    }
  }, [ownerToken]);

  useEffect(() => {
    if (Array.isArray(livePlayers)) {
      setServerPlayers(livePlayers);
    }
  }, [livePlayers]);

  useEffect(() => {
    void fetchServerPlayers();
    const timer = setInterval(() => {
      void fetchServerPlayers();
    }, 8000);
    return () => clearInterval(timer);
  }, [fetchServerPlayers]);

  const handleConnectGoogleCloud = async () => {
    setCloudSyncError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (cred.user.email?.toLowerCase() !== OWNER_ADMIN_EMAIL.toLowerCase()) {
        setCloudSyncError(`Vui lòng chọn tài khoản ${OWNER_ADMIN_EMAIL} để đồng bộ Cloud.`);
      }
    } catch (err) {
      setCloudSyncError(err instanceof Error ? err.message : 'Không thể kết nối Google.');
    }
  };

  // Merge server & Firestore cloud players without duplicates
  const allPlayers = useMemo(() => {
    const map = new Map<string, TrackedPlayer>();
    for (const p of cloudPlayers) {
      map.set(p.id, p);
    }
    for (const p of serverPlayers) {
      const existing = map.get(p.id);
      if (!existing || p.lastLoginAt >= existing.lastLoginAt) {
        map.set(p.id, p);
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      return b.lastLoginAt - a.lastLoginAt;
    });
  }, [serverPlayers, cloudPlayers]);

  const onlineCount = useMemo(
    () => allPlayers.filter((p) => p.isOnline).length,
    [allPlayers],
  );

  const filteredPlayers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return allPlayers;
    return allPlayers.filter(
      (p) =>
        p.displayName.toLowerCase().includes(q) ||
        p.username.toLowerCase().includes(q),
    );
  }, [allPlayers, searchTerm]);

  if (isMinimized && !isExpandedModal) {
    return (
      <button
        type="button"
        onClick={() => setIsMinimized(false)}
        className="fixed bottom-3 right-3 sm:bottom-4 sm:right-4 z-40 flex items-center gap-2 px-3 py-2 rounded-full p-[2px] gold-metallic-frame shadow-[0_10px_28px_rgba(0,0,0,0.9)] hover:brightness-110 active:scale-95 transition-all"
        title="Mở ô danh sách người chơi"
      >
        <span className="flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-b from-[#2f1a0c] to-[#120703] text-amber-100 text-xs font-bold">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
          <Users className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
          <span>Người chơi ({allPlayers.length})</span>
          <ChevronUp className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
        </span>
      </button>
    );
  }

  return (
    <>
      {/* Small docked floating box for Owner ("ô nhỏ") */}
      {!isExpandedModal && (
        <aside
          aria-label="Danh sách người chơi đăng nhập"
          className="fixed bottom-3 right-3 sm:bottom-4 sm:right-4 z-40 w-[256px] sm:w-[292px] rounded-2xl p-[2px] gold-metallic-frame shadow-[0_18px_45px_rgba(0,0,0,0.95)]"
        >
          <div className="rounded-[14px] bg-gradient-to-b from-[#221107] via-[#150a05] to-[#0c0503] text-amber-50 overflow-hidden">
            {/* Compact Header */}
            <div className="flex items-center justify-between gap-1.5 px-3 py-2 border-b border-amber-500/30 bg-black/40">
              <div className="flex items-center gap-1.5 min-w-0">
                <Crown className="w-3.5 h-3.5 text-amber-300 shrink-0" aria-hidden="true" />
                <span className="font-display text-xs font-extrabold text-amber-200 truncate">
                  Người chơi ({allPlayers.length})
                </span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-[10px] font-bold text-emerald-300 shrink-0">
                  {onlineCount} on
                </span>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => void fetchServerPlayers()}
                  aria-label="Làm mới danh sách"
                  title="Làm mới"
                  className="p-1 rounded hover:bg-amber-500/20 text-amber-300/80 hover:text-amber-200 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setIsExpandedModal(true)}
                  aria-label="Mở rộng xem tất cả người chơi"
                  title="Xem tất cả"
                  className="p-1 rounded hover:bg-amber-500/20 text-amber-300/80 hover:text-amber-200 transition-colors"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsMinimized(true)}
                  aria-label="Thu gọn ô người chơi"
                  title="Thu gọn"
                  className="p-1 rounded hover:bg-amber-500/20 text-amber-300/80 hover:text-amber-200 transition-colors"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Compact Scrollable Player List */}
            <div className="max-h-[168px] overflow-y-auto divide-y divide-amber-500/15 px-2.5 py-1.5">
              {allPlayers.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-amber-200/65">
                  Chưa có người chơi nào đăng nhập.
                </p>
              ) : (
                allPlayers.map((p) => (
                  <div key={p.id} className="py-1.5 flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          p.isOnline
                            ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]'
                            : 'bg-stone-500'
                        }`}
                        title={p.isOnline ? 'Đang online' : 'Offline'}
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-amber-100 truncate leading-tight">
                          {p.displayName}
                        </p>
                        <p className="text-[10px] text-amber-300/60 truncate">
                          @{p.username} · {formatLoginTime(p.lastLoginAt)}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono-num text-[11px] font-bold text-amber-300 shrink-0">
                      {p.balance.toLocaleString('en-US')}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Cloud Sync Status Footer */}
            <div className="px-2.5 py-1.5 border-t border-amber-500/25 bg-black/45 flex items-center justify-between gap-2">
              {isCloudAdmin ? (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-300 truncate">
                  <Cloud className="w-3 h-3 shrink-0" />
                  Đã đồng bộ Cloud ({cloudPlayers.length})
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleConnectGoogleCloud()}
                  className="w-full flex items-center justify-center gap-1.5 py-1 px-2 rounded-lg bg-amber-500/15 border border-amber-400/40 text-[10px] font-bold text-amber-200 hover:bg-amber-500/25 transition-colors"
                >
                  <Cloud className="w-3 h-3 shrink-0" />
                  <span>Đồng bộ Cloud Google</span>
                </button>
              )}
            </div>
            {cloudSyncError && (
              <p className="px-2.5 pb-1.5 text-[10px] text-rose-400 text-center">
                {cloudSyncError}
              </p>
            )}
          </div>
        </aside>
      )}

      {/* Expanded Full Modal to inspect ALL players */}
      {isExpandedModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4"
          onClick={() => setIsExpandedModal(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Tất cả người chơi"
        >
          <div
            className="w-full max-w-[580px] rounded-[22px] p-[2px] gold-metallic-frame shadow-[0_26px_70px_rgba(0,0,0,0.95)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rounded-[20px] bg-gradient-to-b from-[#241108] via-[#140904] to-[#0a0402] text-amber-50 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-amber-500/30 bg-black/45">
                <div className="flex items-center gap-2">
                  <Crown className="w-5 h-5 text-amber-300" />
                  <div>
                    <h2 className="font-display text-sm sm:text-base font-extrabold text-amber-200">
                      Tất Cả Người Chơi ({allPlayers.length})
                    </h2>
                    <p className="text-[11px] text-emerald-300/85">
                      Đang hoạt động: {onlineCount} · Đã đồng bộ {isCloudAdmin ? 'Máy chủ + Cloud' : 'Máy chủ'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIsExpandedModal(false)}
                    aria-label="Thu nhỏ về ô góc màn hình"
                    title="Thu nhỏ"
                    className="p-1.5 rounded-lg bg-amber-500/15 text-amber-200 hover:bg-amber-500/30 transition-colors"
                  >
                    <Minimize2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsExpandedModal(false)}
                    aria-label="Đóng"
                    className="p-1.5 rounded-lg bg-amber-500/15 text-amber-200 hover:bg-rose-500/30 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search className="w-4 h-4 text-amber-300/60 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Tìm theo tên hoặc username..."
                      className="w-full h-9 pl-9 pr-3 rounded-xl bg-black/55 border border-amber-500/40 text-xs sm:text-sm text-amber-100 placeholder:text-stone-400 outline-none focus:border-amber-300"
                    />
                  </div>
                  {!isCloudAdmin && (
                    <button
                      type="button"
                      onClick={() => void handleConnectGoogleCloud()}
                      className="h-9 px-3 rounded-xl bg-amber-500/20 border border-amber-400/50 text-xs font-bold text-amber-200 hover:bg-amber-500/30 flex items-center gap-1.5"
                    >
                      <Cloud className="w-3.5 h-3.5" />
                      <span>Đồng bộ Cloud Google</span>
                    </button>
                  )}
                </div>

                <div className="max-h-[55dvh] overflow-y-auto divide-y divide-amber-500/15 rounded-xl border border-amber-500/25 bg-black/35">
                  {filteredPlayers.length === 0 ? (
                    <p className="py-8 text-center text-sm text-amber-200/65">
                      Không có người chơi nào phù hợp.
                    </p>
                  ) : (
                    filteredPlayers.map((p, idx) => (
                      <div key={p.id} className="px-3.5 py-2.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="font-mono-num text-xs text-amber-400/70 w-5 shrink-0">
                            {idx + 1}.
                          </span>
                          <span
                            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                              p.isOnline
                                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]'
                                : 'bg-stone-500'
                            }`}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-sm text-amber-100 truncate">
                                {p.displayName}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-[10px] text-amber-300/85 uppercase">
                                {p.authSource === 'google' ? 'Google' : 'Web'}
                              </span>
                            </div>
                            <p className="text-xs text-amber-300/65 truncate">
                              @{p.username} · Đăng nhập: {formatLoginTime(p.lastLoginAt)}
                            </p>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <p className="font-mono-num text-xs sm:text-sm font-bold text-amber-300">
                            {p.balance.toLocaleString('en-US')} Xu
                          </p>
                          <p className="text-[10px] text-stone-400">
                            {p.isOnline ? 'Đang trong bàn' : 'Đã thoát'}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
