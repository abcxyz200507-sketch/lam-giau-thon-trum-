import React, { useState } from 'react';
import { X, Trophy, HelpCircle, BarChart3, Landmark, Copy, Check, FileClock, ChevronDown, ArrowLeft } from 'lucide-react';
import { RoundResult, WithdrawRecord } from '../types/game';

interface ModalShellProps {
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}

const ModalShell: React.FC<ModalShellProps> = ({ title, icon, onClose, children }) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="tx-modal-box w-full max-w-xl rounded-2xl border-2 border-amber-500/60 bg-gradient-to-b from-[#2b180b] via-[#1b0e05] to-[#110803] text-amber-50 shadow-[0_24px_60px_rgba(0,0,0,0.9)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tx-modal-header flex items-center justify-between px-5 py-4 border-b border-amber-500/25 bg-black/30">
          <div className="flex items-center gap-2.5">
            <span className="text-amber-400">{icon}</span>
            <h2 className="font-display text-lg font-bold tracking-wide text-amber-100">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center w-10 h-10 rounded-full border border-amber-500/35 bg-amber-950/60 text-amber-200 hover:bg-amber-800/60 transition-colors focus-visible:outline-2 focus-visible:outline-amber-400"
            aria-label="Đóng cửa sổ"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="tx-modal-body p-5 max-h-[75vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};

export const RulesModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <ModalShell title="Luật Chơi Tài Xỉu" icon={<HelpCircle className="w-5 h-5" />} onClose={onClose}>
    <div className="space-y-4 text-sm leading-relaxed text-amber-100/90">
      <p>
        Trò chơi giải trí Tài Xỉu sử dụng <strong className="text-amber-300">3 viên xúc xắc</strong>, mỗi viên có 6 mặt từ 1 đến 6 chấm. Kết quả dựa trên tổng điểm của 3 viên sau mỗi phiên 60 giây.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-amber-400/35 bg-amber-950/40 p-4">
          <div className="font-display text-xl font-extrabold text-amber-300 mb-1">TÀI (11 – 18 điểm)</div>
          <p className="text-xs text-amber-100/80">
            Khi tổng số chấm của 3 viên xúc xắc nằm trong khoảng từ 11 đến 18, kết quả là TÀI (bi màu đen).
          </p>
        </div>
        <div className="rounded-xl border border-amber-400/25 bg-black/40 p-4">
          <div className="font-display text-xl font-extrabold text-amber-100 mb-1">XỈU (3 – 10 điểm)</div>
          <p className="text-xs text-amber-100/80">
            Khi tổng số chấm của 3 viên xúc xắc nằm trong khoảng từ 3 đến 10, kết quả là XỈU (bi màu trắng).
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-black/30 p-4 space-y-2 text-xs text-amber-100/85">
        <div className="font-semibold text-amber-300 text-sm">Cơ chế vòng lặp 60 giây tự động</div>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Từ giây 60 xuống giây 10: Hệ thống đóng nắp che xúc xắc để người chơi chọn cửa TÀI hoặc XỈU.</li>
          <li>Biểu tượng bàn tay bên cạnh bát: Khi bật (không gạch chéo), người chơi tự chạm hoặc kéo mở nắp từ giây 10 đến 0; khi tắt (có đường chéo), hệ thống tự mở nắp ngay ở giây thứ 10.</li>
          <li>Hết thời gian xem kết quả ở giây 0, nắp tự động đóng lại, mã phiên tăng thêm 1 và bắt đầu vòng 60 giây mới.</li>
        </ul>
      </div>
    </div>
  </ModalShell>
);

export const StatsModal: React.FC<{ history: RoundResult[]; onClose: () => void }> = ({
  history,
  onClose,
}) => {
  const totalRounds = history.length;
  const taiCount = history.filter((r) => r.outcome === 'TAI').length;
  const xiuCount = totalRounds - taiCount;
  const taiPct = totalRounds > 0 ? Math.round((taiCount / totalRounds) * 100) : 50;
  const xiuPct = 100 - taiPct;

  const avgScore =
    totalRounds > 0
      ? (history.reduce((acc, r) => acc + r.total, 0) / totalRounds).toFixed(1)
      : '10.5';

  // Longest streak
  let currentStreak = 0;
  let streakSide: 'TAI' | 'XIU' | null = history[0]?.outcome ?? null;
  for (const r of history) {
    if (r.outcome === streakSide) currentStreak += 1;
    else break;
  }

  // Distribution by total (3..18)
  const scoreCounts: Record<number, number> = {};
  for (let s = 3; s <= 18; s++) scoreCounts[s] = 0;
  history.forEach((r) => {
    scoreCounts[r.total] = (scoreCounts[r.total] || 0) + 1;
  });
  const maxBucket = Math.max(1, ...Object.values(scoreCounts));

  return (
    <ModalShell
      title="Thống Kê Phiên Gần Đây"
      icon={<BarChart3 className="w-5 h-5" />}
      onClose={onClose}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl border border-amber-500/25 bg-black/35 p-3">
            <div className="text-xs text-amber-200/70">Tổng số phiên</div>
            <div className="font-mono-num text-xl font-bold text-amber-100 mt-0.5">{totalRounds}</div>
          </div>
          <div className="rounded-xl border border-amber-500/25 bg-black/35 p-3">
            <div className="text-xs text-amber-200/70">Điểm trung bình</div>
            <div className="font-mono-num text-xl font-bold text-amber-300 mt-0.5">{avgScore}</div>
          </div>
          <div className="rounded-xl border border-amber-500/25 bg-black/35 p-3">
            <div className="text-xs text-amber-200/70">Chuỗi hiện tại</div>
            <div className="font-display text-lg font-bold text-amber-200 mt-0.5">
              {currentStreak} {streakSide === 'TAI' ? 'Tài' : 'Xỉu'}
            </div>
          </div>
        </div>

        {/* Ratio Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-semibold">
            <span className="text-amber-300">TÀI: {taiCount} phiên ({taiPct}%)</span>
            <span className="text-amber-100/80">XỈU: {xiuCount} phiên ({xiuPct}%)</span>
          </div>
          <div className="h-3.5 w-full rounded-full bg-zinc-900 overflow-hidden border border-amber-500/40 flex">
            <div
              className="h-full bg-gradient-to-r from-zinc-800 to-black border-r border-amber-400/50 transition-all duration-300"
              style={{ width: `${taiPct}%` }}
            />
            <div
              className="h-full bg-gradient-to-r from-stone-100 to-white transition-all duration-300"
              style={{ width: `${xiuPct}%` }}
            />
          </div>
        </div>

        {/* Score Histogram 3..18 */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-amber-200/80">Phân bố tổng điểm (3 – 18)</div>
          <div className="grid grid-cols-16 gap-1 items-end h-28 pt-4 px-2 rounded-xl bg-black/35 border border-amber-500/20">
            {Array.from({ length: 16 }, (_, idx) => idx + 3).map((score) => {
              const count = scoreCounts[score] || 0;
              const pct = Math.round((count / maxBucket) * 100);
              const isTai = score >= 11;
              return (
                <div key={score} className="flex flex-col items-center justify-end h-full gap-1">
                  <div className="w-full flex items-end justify-center flex-1">
                    <div
                      className={`w-full rounded-t-sm transition-all ${
                        isTai ? 'bg-zinc-950 border border-amber-400/75' : 'bg-stone-100'
                      }`}
                      style={{ height: `${Math.max(count > 0 ? 14 : 4, pct)}%`, opacity: count > 0 ? 1 : 0.25 }}
                      title={`Điểm ${score}: ${count} lần`}
                    />
                  </div>
                  <span className="font-mono-num text-[10px] text-amber-200/75">{score}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </ModalShell>
  );
};

export const HistoryModal: React.FC<{ history: RoundResult[]; onClose: () => void }> = ({
  history,
  onClose,
}) => (
  <ModalShell title="Lịch Sử Kết Quả Chi Tiết" icon={<Trophy className="w-5 h-5" />} onClose={onClose}>
    {history.length === 0 ? (
      <p className="text-sm text-amber-200/70 text-center py-6">Chưa có dữ liệu phiên nào.</p>
    ) : (
      <div className="divide-y divide-amber-500/15">
        {history.map((round) => (
          <div key={round.sessionId} className="py-3 flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-3">
              <span
                className={`flex items-center justify-center w-8 h-8 rounded-full font-mono-num text-xs font-bold border ${
                  round.outcome === 'TAI'
                    ? 'bg-zinc-950 text-amber-200 border-amber-400/70'
                    : 'bg-gradient-to-b from-white to-stone-200 text-zinc-950 border-amber-200'
                }`}
              >
                {round.total}
              </span>
              <div>
                <div className="font-mono-num text-xs font-semibold text-amber-200">
                  #{round.sessionId}
                </div>
                <div className="text-xs text-amber-100/70 font-mono-num">
                  Xúc xắc: {round.dice[0]} · {round.dice[1]} · {round.dice[2]}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 text-right">
              {round.userSide && round.userStake ? (
                <div className="text-xs font-mono-num">
                  <span className={round.userNet && round.userNet > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {round.userNet && round.userNet > 0
                      ? `+${round.userNet.toLocaleString('en-US')}`
                      : `-${round.userStake.toLocaleString('en-US')}`}
                  </span>
                </div>
              ) : null}
              <span
                className={`font-display text-sm font-extrabold min-w-[48px] text-right ${
                  round.outcome === 'TAI' ? 'text-amber-300' : 'text-stone-200'
                }`}
              >
                {round.outcome === 'TAI' ? 'TÀI' : 'XỈU'}
              </span>
            </div>
          </div>
        ))}
      </div>
    )}
  </ModalShell>
);

const DEPOSIT_AMOUNTS = [100000, 200000, 500000, 1000000, 5000000] as const;

export const DepositModal: React.FC<{
  sessionId: number;
  onConfirmDeposit: (amount: number) => void;
  onClose: () => void;
}> = ({ sessionId, onConfirmDeposit, onClose }) => {
  const [selectedAmount, setSelectedAmount] = useState<number>(500000);
  const [copiedField, setCopiedField] = useState<'stk' | 'note' | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const transferNote = `NAPXU ${sessionId}`;

  const handleCopy = (value: string, field: 'stk' | 'note') => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(value).catch(() => {});
    }
    setCopiedField(field);
    setTimeout(() => setCopiedField((prev) => (prev === field ? null : prev)), 2000);
  };

  const handleConfirm = () => {
    onConfirmDeposit(selectedAmount);
    setSubmitted(true);
    setTimeout(() => {
      onClose();
    }, 900);
  };

  return (
    <ModalShell title="Nạp Tiền Chuyển Khoản" icon={<Landmark className="w-5 h-5" />} onClose={onClose}>
      <div className="space-y-4">
        {/* Bank Account Card */}
        <div className="rounded-xl border border-amber-400/45 bg-black/45 p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-amber-500/20 pb-2.5">
            <span className="text-xs text-amber-200/75">Ngân hàng</span>
            <span className="font-display text-base font-extrabold text-amber-300">MB</span>
          </div>

          <div className="flex items-center justify-between border-b border-amber-500/20 pb-2.5 gap-2">
            <span className="text-xs text-amber-200/75">Số tài khoản (STK)</span>
            <div className="flex items-center gap-2">
              <span className="font-mono-num text-base sm:text-lg font-extrabold tracking-wider text-amber-100">
                0356658543
              </span>
              <button
                type="button"
                onClick={() => handleCopy('0356658543', 'stk')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-400/50 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 transition-colors"
                aria-label="Sao chép số tài khoản"
              >
                {copiedField === 'stk' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-300">Đã chép</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Sao chép</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-amber-500/20 pb-2.5">
            <span className="text-xs text-amber-200/75">Chủ tài khoản</span>
            <span className="font-display text-sm sm:text-base font-bold uppercase text-amber-100">
              Lê Anh Tú
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-amber-200/75">Nội dung chuyển khoản</span>
            <div className="flex items-center gap-2">
              <span className="font-mono-num text-sm font-bold text-amber-300">{transferNote}</span>
              <button
                type="button"
                onClick={() => handleCopy(transferNote, 'note')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-400/50 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 transition-colors"
                aria-label="Sao chép nội dung chuyển khoản"
              >
                {copiedField === 'note' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-300">Đã chép</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Sao chép</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Amount Preset Selection */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-amber-200/80">Chọn mức Xu nạp</div>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {DEPOSIT_AMOUNTS.map((amount) => {
              const active = selectedAmount === amount;
              return (
                <button
                  key={amount}
                  type="button"
                  onClick={() => setSelectedAmount(amount)}
                  className={`min-h-[40px] px-2 py-1.5 rounded-lg font-mono-num text-xs font-bold transition-all ${
                    active
                      ? 'bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 shadow-[0_0_12px_rgba(245,158,11,0.45)]'
                      : 'bg-black/45 text-amber-200 border border-amber-500/35 hover:border-amber-400/70'
                  }`}
                >
                  {amount.toLocaleString('en-US')}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          disabled={submitted}
          onClick={handleConfirm}
          className="w-full min-h-[44px] py-2.5 px-5 rounded-xl bg-gradient-to-b from-amber-300 via-amber-400 to-amber-600 text-amber-950 font-display text-sm sm:text-base font-extrabold tracking-wide shadow-lg hover:brightness-105 active:scale-[0.99] transition-all disabled:opacity-75"
        >
          {submitted
            ? `Đã cộng +${selectedAmount.toLocaleString('en-US')} Xu`
            : `Xác nhận nạp ${selectedAmount.toLocaleString('en-US')} Xu`}
        </button>
      </div>
    </ModalShell>
  );
};

const BANK_OPTIONS = [
  'MBbank',
  'Vietcombank',
  'Techcombank',
  'VietinBank',
  'BIDV',
  'ACB',
  'VPBank',
  'TPBank',
  'Sacombank',
  'Agribank',
  'SHB',
  'VIB',
  'HDBank',
  'MSB',
  'OCB',
  'SeABank',
  'Eximbank',
  'LPBank',
] as const;

const CARD_CARRIERS = ['Viettel', 'Mobifone', 'Vinaphone', 'Vietnamobile'] as const;
const CARD_VALUES = [50000, 100000, 200000, 500000] as const;
const CRYPTO_NETWORKS = ['USDT (TRC20)', 'USDT (BEP20)', 'USDT (ERC20)', 'TON'] as const;

export const WithdrawModal: React.FC<{
  balance: number;
  withdrawHistory: WithdrawRecord[];
  onConfirmWithdraw: (record: Omit<WithdrawRecord, 'id' | 'timestamp'>) => void;
  onClose: () => void;
}> = ({ balance, withdrawHistory, onConfirmWithdraw, onClose }) => {
  const [activeTab, setActiveTab] = useState<'NGÂN HÀNG' | 'THẺ CÀO' | 'TIỀN ĐIỆN TỬ'>('NGÂN HÀNG');
  const [showHistory, setShowHistory] = useState(false);

  // Bank tab fields
  const [bankName, setBankName] = useState<string>('MBbank');
  const [accountNumber, setAccountNumber] = useState<string>('');
  const [accountHolder, setAccountHolder] = useState<string>('');
  const [bankAmount, setBankAmount] = useState<string>('');

  // Card tab fields
  const [carrier, setCarrier] = useState<string>('Viettel');
  const [cardValue, setCardValue] = useState<number>(100000);
  const [cardPhone, setCardPhone] = useState<string>('');

  // Crypto tab fields
  const [cryptoNetwork, setCryptoNetwork] = useState<string>('USDT (TRC20)');
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [cryptoAmount, setCryptoAmount] = useState<string>('');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const resetFeedback = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    resetFeedback();

    if (activeTab === 'NGÂN HÀNG') {
      const cleanedAcc = accountNumber.trim();
      const cleanedHolder = accountHolder.trim().toUpperCase();
      const parsedAmount = Number(bankAmount.replace(/[^0-9]/g, ''));

      if (!cleanedAcc) {
        setErrorMsg('Vui lòng nhập Số Tài Khoản.');
        return;
      }
      if (!cleanedHolder) {
        setErrorMsg('Vui lòng nhập Tên Tài Khoản.');
        return;
      }
      if (!parsedAmount || parsedAmount <= 0) {
        setErrorMsg('Vui lòng nhập Số Tiền Rút hợp lệ.');
        return;
      }
      if (parsedAmount > balance) {
        setErrorMsg('Số dư hiện tại không đủ để rút số tiền này.');
        return;
      }

      onConfirmWithdraw({
        method: 'NGÂN HÀNG',
        destination: `${bankName} · ${cleanedAcc}`,
        accountName: cleanedHolder,
        amount: parsedAmount,
      });
      setSuccessMsg(`Đã gửi lệnh rút ${parsedAmount.toLocaleString('en-US')} về ${bankName}!`);
      setBankAmount('');
      return;
    }

    if (activeTab === 'THẺ CÀO') {
      if (cardValue > balance) {
        setErrorMsg('Số dư hiện tại không đủ để đổi mệnh giá thẻ này.');
        return;
      }
      const contact = cardPhone.trim() || 'Nhận mã thẻ trực tiếp';
      onConfirmWithdraw({
        method: 'THẺ CÀO',
        destination: `Thẻ ${carrier}`,
        accountName: contact,
        amount: cardValue,
      });
      setSuccessMsg(`Đã đổi thẻ ${carrier} ${cardValue.toLocaleString('en-US')} thành công!`);
      return;
    }

    // TIỀN ĐIỆN TỬ
    const cleanedWallet = walletAddress.trim();
    const parsedCrypto = Number(cryptoAmount.replace(/[^0-9]/g, ''));
    if (!cleanedWallet) {
      setErrorMsg('Vui lòng nhập địa chỉ ví nhận.');
      return;
    }
    if (!parsedCrypto || parsedCrypto <= 0) {
      setErrorMsg('Vui lòng nhập Số Tiền Rút hợp lệ.');
      return;
    }
    if (parsedCrypto > balance) {
      setErrorMsg('Số dư hiện tại không đủ để rút số tiền này.');
      return;
    }
    onConfirmWithdraw({
      method: 'TIỀN ĐIỆN TỬ',
      destination: `${cryptoNetwork}`,
      accountName: cleanedWallet,
      amount: parsedCrypto,
    });
    setSuccessMsg(`Đã gửi lệnh rút ${parsedCrypto.toLocaleString('en-US')} qua ${cryptoNetwork}!`);
    setCryptoAmount('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Rút tiền"
    >
      <div
        className="tx-modal-box relative w-full max-w-[600px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Row: 3 Tabs matching reference screenshot + Close X button */}
        <div className="flex items-end justify-between gap-1.5 sm:gap-2 pl-0.5 pr-0.5">
          <div className="flex items-end gap-1 sm:gap-2">
            {(['NGÂN HÀNG', 'THẺ CÀO', 'TIỀN ĐIỆN TỬ'] as const).map((tab) => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab);
                    setShowHistory(false);
                    resetFeedback();
                  }}
                  className={`min-h-[40px] sm:min-h-[42px] px-2.5 sm:px-6 py-2 rounded-t-2xl font-display text-[11px] sm:text-sm font-extrabold tracking-wide uppercase whitespace-nowrap transition-all border-t-2 border-x-2 ${
                    isActive
                      ? 'bg-gradient-to-b from-[#4a261e] via-[#2b1014] to-[#1d0c10] text-amber-100 border-[#f2d8a7] shadow-[0_-4px_14px_rgba(245,185,66,0.28)] relative z-10 -mb-[2px]'
                      : 'bg-gradient-to-b from-[#1a0912] to-[#11040b] text-[#e7c677]/90 border-[#b9935a]/65 hover:text-amber-100'
                  }`}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="mb-1.5 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full border-2 border-[#f2d8a7] bg-gradient-to-b from-[#5e3817] to-[#1a0b04] text-amber-100 hover:brightness-115 active:scale-95 transition-all shrink-0 shadow-lg"
            aria-label="Đóng cửa sổ rút tiền"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Main Obsidian-Plum Framed Body */}
        <div className="tx-modal-body relative rounded-b-2xl rounded-tr-2xl border-2 border-[#c9a87a]/85 bg-gradient-to-b from-[#201016] via-[#190b10] to-[#12060b] px-4 py-5 sm:px-8 sm:py-7 shadow-[0_24px_65px_rgba(0,0,0,0.95)] max-h-[82dvh] overflow-y-auto">
          {showHistory ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-amber-400/25 pb-2.5">
                <span className="font-display text-sm sm:text-base font-bold text-[#e7c677]">
                  Lịch Sử Rút Tiền
                </span>
                <button
                  type="button"
                  onClick={() => setShowHistory(false)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#c9a87a]/65 bg-[#12040a] text-xs font-semibold text-amber-100 hover:border-amber-300"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Quay lại</span>
                </button>
              </div>

              {withdrawHistory.length === 0 ? (
                <p className="text-center text-sm text-amber-100/65 py-8">
                  Chưa có giao dịch rút tiền nào trong phiên.
                </p>
              ) : (
                <div className="divide-y divide-amber-500/15 max-h-60 overflow-y-auto pr-1">
                  {withdrawHistory.map((item) => (
                    <div key={item.id} className="py-2.5 flex items-center justify-between gap-3 text-xs sm:text-sm">
                      <div>
                        <div className="font-semibold text-amber-100">{item.destination}</div>
                        <div className="text-amber-200/65 text-xs">
                          {item.accountName} · {new Date(item.timestamp).toLocaleTimeString('vi-VN')}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono-num font-bold text-amber-300">
                          -{item.amount.toLocaleString('en-US')}
                        </div>
                        <div className="text-[11px] font-semibold text-emerald-400">Thành công</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {activeTab === 'NGÂN HÀNG' && (
                <>
                  {/* Row 1: Ngân Hàng Select */}
                  <div className="grid grid-cols-1 sm:grid-cols-[155px_1fr] items-center gap-1.5 sm:gap-4">
                    <label
                      htmlFor="withdraw-bank"
                      className="text-sm sm:text-base font-semibold text-[#e7c677]"
                    >
                      Ngân Hàng:
                    </label>
                    <div className="relative">
                      <select
                        id="withdraw-bank"
                        value={bankName}
                        onChange={(e) => {
                          setBankName(e.target.value);
                          resetFeedback();
                        }}
                        className="w-full appearance-none h-10 sm:h-11 pl-4 pr-10 rounded-full bg-[#130309] border border-[#d6b98d]/85 text-sm sm:text-base font-semibold text-amber-50 outline-none focus:border-amber-300 shadow-[inset_0_2px_6px_rgba(0,0,0,0.85)] cursor-pointer"
                      >
                        {BANK_OPTIONS.map((bank) => (
                          <option key={bank} value={bank} className="bg-[#1b0810] text-amber-50">
                            {bank}
                          </option>
                        ))}
                      </select>
                      <svg
                        viewBox="0 0 12 8"
                        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 w-3.5 h-2.5 text-[#f0ce7c]"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M1 1h10L6 7z" />
                      </svg>
                    </div>
                  </div>

                  {/* Row 2: Số Tài Khoản */}
                  <div className="grid grid-cols-1 sm:grid-cols-[155px_1fr] items-center gap-1.5 sm:gap-4">
                    <label
                      htmlFor="withdraw-account-number"
                      className="text-sm sm:text-base font-semibold text-[#e7c677]"
                    >
                      Số Tài Khoản:
                    </label>
                    <input
                      id="withdraw-account-number"
                      type="text"
                      inputMode="numeric"
                      value={accountNumber}
                      onChange={(e) => {
                        setAccountNumber(e.target.value);
                        resetFeedback();
                      }}
                      placeholder="Nhập số tài khoản"
                      className="w-full h-10 sm:h-11 px-4 rounded-full bg-[#130309] border border-[#d6b98d]/85 text-sm sm:text-base font-mono-num text-amber-50 placeholder:text-amber-100/30 outline-none focus:border-amber-300 shadow-[inset_0_2px_6px_rgba(0,0,0,0.85)]"
                    />
                  </div>

                  {/* Row 3: Tên Tài Khoản */}
                  <div className="grid grid-cols-1 sm:grid-cols-[155px_1fr] items-center gap-1.5 sm:gap-4">
                    <label
                      htmlFor="withdraw-account-holder"
                      className="text-sm sm:text-base font-semibold text-[#e7c677]"
                    >
                      Tên Tài Khoản:
                    </label>
                    <input
                      id="withdraw-account-holder"
                      type="text"
                      value={accountHolder}
                      onChange={(e) => {
                        setAccountHolder(e.target.value);
                        resetFeedback();
                      }}
                      placeholder="Nhập tên chủ tài khoản"
                      className="w-full h-10 sm:h-11 px-4 rounded-full bg-[#130309] border border-[#d6b98d]/85 text-sm sm:text-base uppercase text-amber-50 placeholder:normal-case placeholder:text-amber-100/30 outline-none focus:border-amber-300 shadow-[inset_0_2px_6px_rgba(0,0,0,0.85)]"
                    />
                  </div>

                  {/* Row 4: Số Tiền Rút */}
                  <div className="grid grid-cols-1 sm:grid-cols-[155px_1fr] items-center gap-1.5 sm:gap-4">
                    <label
                      htmlFor="withdraw-amount"
                      className="text-sm sm:text-base font-semibold text-[#e7c677]"
                    >
                      Số Tiền Rút:
                    </label>
                    <input
                      id="withdraw-amount"
                      type="text"
                      inputMode="numeric"
                      value={bankAmount}
                      onChange={(e) => {
                        setBankAmount(e.target.value.replace(/[^0-9]/g, ''));
                        resetFeedback();
                      }}
                      placeholder={`Tối đa ${balance.toLocaleString('en-US')}`}
                      className="w-full h-10 sm:h-11 px-4 rounded-full bg-[#130309] border border-[#d6b98d]/85 text-sm sm:text-base font-mono-num text-amber-50 placeholder:text-amber-100/30 outline-none focus:border-amber-300 shadow-[inset_0_2px_6px_rgba(0,0,0,0.85)]"
                    />
                  </div>
                </>
              )}

              {activeTab === 'THẺ CÀO' && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-[155px_1fr] items-center gap-1.5 sm:gap-4">
                    <label
                      htmlFor="withdraw-carrier"
                      className="text-sm sm:text-base font-semibold text-[#e7c677]"
                    >
                      Nhà Mạng:
                    </label>
                    <div className="relative">
                      <select
                        id="withdraw-carrier"
                        value={carrier}
                        onChange={(e) => {
                          setCarrier(e.target.value);
                          resetFeedback();
                        }}
                        className="w-full appearance-none h-10 sm:h-11 pl-4 pr-10 rounded-full bg-[#130309] border border-[#d6b98d]/85 text-sm sm:text-base font-semibold text-amber-50 outline-none focus:border-amber-300 shadow-[inset_0_2px_6px_rgba(0,0,0,0.85)] cursor-pointer"
                      >
                        {CARD_CARRIERS.map((c) => (
                          <option key={c} value={c} className="bg-[#1b0810] text-amber-50">
                            {c}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#e7c677]"
                        aria-hidden="true"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-[155px_1fr] items-center gap-1.5 sm:gap-4">
                    <span className="text-sm sm:text-base font-semibold text-[#e7c677]">
                      Mệnh Giá:
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {CARD_VALUES.map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => {
                            setCardValue(val);
                            resetFeedback();
                          }}
                          className={`min-h-[40px] px-2 py-1.5 rounded-full font-mono-num text-xs font-bold border transition-all ${
                            cardValue === val
                              ? 'bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 border-amber-200'
                              : 'bg-[#130309] text-amber-100 border-[#d6b98d]/60 hover:border-amber-300'
                          }`}
                        >
                          {(val / 1000).toLocaleString('en-US')}K
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-[155px_1fr] items-center gap-1.5 sm:gap-4">
                    <label
                      htmlFor="withdraw-card-phone"
                      className="text-sm sm:text-base font-semibold text-[#e7c677]"
                    >
                      SĐT Nhận Thẻ:
                    </label>
                    <input
                      id="withdraw-card-phone"
                      type="text"
                      inputMode="tel"
                      value={cardPhone}
                      onChange={(e) => {
                        setCardPhone(e.target.value);
                        resetFeedback();
                      }}
                      placeholder="Không bắt buộc"
                      className="w-full h-10 sm:h-11 px-4 rounded-full bg-[#130309] border border-[#d6b98d]/85 text-sm sm:text-base font-mono-num text-amber-50 placeholder:text-amber-100/30 outline-none focus:border-amber-300 shadow-[inset_0_2px_6px_rgba(0,0,0,0.85)]"
                    />
                  </div>
                </>
              )}

              {activeTab === 'TIỀN ĐIỆN TỬ' && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-[155px_1fr] items-center gap-1.5 sm:gap-4">
                    <label
                      htmlFor="withdraw-network"
                      className="text-sm sm:text-base font-semibold text-[#e7c677]"
                    >
                      Mạng Lưới:
                    </label>
                    <div className="relative">
                      <select
                        id="withdraw-network"
                        value={cryptoNetwork}
                        onChange={(e) => {
                          setCryptoNetwork(e.target.value);
                          resetFeedback();
                        }}
                        className="w-full appearance-none h-10 sm:h-11 pl-4 pr-10 rounded-full bg-[#130309] border border-[#d6b98d]/85 text-sm sm:text-base font-semibold text-amber-50 outline-none focus:border-amber-300 shadow-[inset_0_2px_6px_rgba(0,0,0,0.85)] cursor-pointer"
                      >
                        {CRYPTO_NETWORKS.map((net) => (
                          <option key={net} value={net} className="bg-[#1b0810] text-amber-50">
                            {net}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#e7c677]"
                        aria-hidden="true"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-[155px_1fr] items-center gap-1.5 sm:gap-4">
                    <label
                      htmlFor="withdraw-wallet"
                      className="text-sm sm:text-base font-semibold text-[#e7c677]"
                    >
                      Địa Chỉ Ví:
                    </label>
                    <input
                      id="withdraw-wallet"
                      type="text"
                      value={walletAddress}
                      onChange={(e) => {
                        setWalletAddress(e.target.value);
                        resetFeedback();
                      }}
                      placeholder="Nhập địa chỉ ví nhận"
                      className="w-full h-10 sm:h-11 px-4 rounded-full bg-[#130309] border border-[#d6b98d]/85 text-sm sm:text-base font-mono-num text-amber-50 placeholder:text-amber-100/30 outline-none focus:border-amber-300 shadow-[inset_0_2px_6px_rgba(0,0,0,0.85)]"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-[155px_1fr] items-center gap-1.5 sm:gap-4">
                    <label
                      htmlFor="withdraw-crypto-amount"
                      className="text-sm sm:text-base font-semibold text-[#e7c677]"
                    >
                      Số Tiền Rút:
                    </label>
                    <input
                      id="withdraw-crypto-amount"
                      type="text"
                      inputMode="numeric"
                      value={cryptoAmount}
                      onChange={(e) => {
                        setCryptoAmount(e.target.value.replace(/[^0-9]/g, ''));
                        resetFeedback();
                      }}
                      placeholder={`Tối đa ${balance.toLocaleString('en-US')}`}
                      className="w-full h-10 sm:h-11 px-4 rounded-full bg-[#130309] border border-[#d6b98d]/85 text-sm sm:text-base font-mono-num text-amber-50 placeholder:text-amber-100/30 outline-none focus:border-amber-300 shadow-[inset_0_2px_6px_rgba(0,0,0,0.85)]"
                    />
                  </div>
                </>
              )}

              {errorMsg && (
                <p className="text-center text-xs sm:text-sm font-semibold text-rose-400">
                  {errorMsg}
                </p>
              )}
              {successMsg && (
                <p className="text-center text-xs sm:text-sm font-semibold text-emerald-400">
                  {successMsg}
                </p>
              )}

              {/* Bottom Action Row: History icon on bottom-left + Glossy Gold "RÚT TIỀN" button centered */}
              <div className="relative pt-2 flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => setShowHistory(true)}
                  aria-label="Xem lịch sử rút tiền"
                  title="Lịch sử rút tiền"
                  className="absolute left-0 bottom-0 w-10 h-10 sm:w-11 sm:h-11 rounded-full p-[2px] gold-metallic-frame shadow-lg hover:scale-105 active:scale-95 transition-transform"
                >
                  <span className="flex items-center justify-center w-full h-full rounded-full bg-gradient-to-b from-[#331b0b] to-[#110702] text-amber-300">
                    <FileClock className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
                  </span>
                </button>

                <button
                  type="submit"
                  className="relative overflow-hidden min-h-[46px] min-w-[174px] sm:min-w-[200px] px-8 py-2.5 rounded-full border-2 border-[#f4d793] bg-gradient-to-b from-[#c79541] via-[#8b5a19] to-[#5d3609] font-display text-sm sm:text-base font-extrabold tracking-wider text-amber-50 uppercase shadow-[0_6px_22px_rgba(245,158,11,0.38),inset_0_2px_6px_rgba(255,244,200,0.4)] hover:brightness-110 active:scale-95 transition-all"
                >
                  <span
                    className="pointer-events-none absolute inset-x-3 top-0.5 h-[44%] rounded-full bg-gradient-to-b from-white/35 to-transparent"
                    aria-hidden="true"
                  />
                  <span className="relative z-10">RÚT TIỀN</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

