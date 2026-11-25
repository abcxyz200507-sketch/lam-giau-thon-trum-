export type DiceValue = 1 | 2 | 3 | 4 | 5 | 6;

export type BetSide = 'TAI' | 'XIU';

export type RoundPhase = 'LOCKED_COVERED' | 'CAN_OPEN' | 'RESULT';

export interface RoundResult {
  sessionId: number;
  dice: [DiceValue, DiceValue, DiceValue];
  total: number;
  outcome: BetSide;
  timestamp: number;
  userSide?: BetSide | null;
  userStake?: number;
  userNet?: number;
}

export interface WithdrawRecord {
  id: string;
  method: 'NGÂN HÀNG' | 'THẺ CÀO' | 'TIỀN ĐIỆN TỬ';
  destination: string;
  accountName: string;
  amount: number;
  timestamp: number;
}
