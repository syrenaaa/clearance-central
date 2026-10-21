/** domain types. brands are only minted by decode.ts */

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** trimmed, lowercased `id@provider` */
export type UserId = Brand<string, "UserId">;
/** utc day, `YYYY-MM-DD` */
export type Day = Brand<string, "Day">;
/** unix secs */
export type UnixTime = Brand<number, "UnixTime">;
export type ServerId = Brand<string, "ServerId">;
export type ReportId = Brand<string, "ReportId">;
export type ClaimId = Brand<string, "ClaimId">;

export const CHECK_OUTCOMES = [
  "allow",
  "flag",
  "deny",
  "bypass",
  "allowlisted",
  "sponsored",
  "steamError",
  "steamDownNew",
] as const;
export type CheckOutcome = typeof CHECK_OUTCOMES[number];
export type CheckCounts = Readonly<Partial<Record<CheckOutcome, number>>>;

/** bucket lower bounds: 0, 10, ..., 130. 130 is open ended */
export const SCORE_BUCKETS = Array.from({ length: 14 }, (_, i) => i * 10);
/** counts by bucket, missing = 0 */
export type ScoreBuckets = Readonly<Record<number, number>>;

export type DailyStats = {
  readonly pluginVersion: string;
  readonly enforce: boolean;
  readonly thresholds: {
    readonly allowScore: number;
    readonly flagScore: number;
  };
  readonly checks: CheckCounts;
  readonly scores: ScoreBuckets;
  readonly bansByJoinScore: ScoreBuckets;
};

export const BAN_CATEGORIES = [
  "cheating",
  "griefing",
  "harassment",
  "ban_evasion",
  "other",
] as const;
export type BanCategory = typeof BAN_CATEGORIES[number];

export type BanReport = {
  readonly kind: "ban";
  readonly clientRef: string;
  readonly userId: UserId;
  readonly at: UnixTime;
  /** secs, null = permanent */
  readonly duration: number | null;
  readonly severity: number;
  readonly category: BanCategory;
};

export type PardonReport = {
  readonly kind: "pardon";
  readonly clientRef: string;
  readonly reportId: ReportId;
  readonly at: UnixTime;
};

export type ReportRequest = BanReport | PardonReport;

export type ServerAddress = {
  readonly address: string;
  readonly port: number;
};

/** authed, non-revoked game server */
export type Server = {
  readonly id: ServerId;
};
