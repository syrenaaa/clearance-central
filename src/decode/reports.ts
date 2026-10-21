/** `POST /v1/reports` body */

import {
  BAN_CATEGORIES,
  type BanCategory,
  type BanReport,
  type PardonReport,
  type ReportRequest,
} from "../types.ts";
import {
  type Decoder,
  fail,
  integer,
  isRecord,
  join,
  literal,
  strictObject,
  string,
} from "./core.ts";
import { reportId, unixTime, userId } from "./scalars.ts";

const clientRef = string(128);

const banReport: Decoder<BanReport> = strictObject<BanReport>({
  kind: literal(["ban"]),
  clientRef,
  userId,
  at: unixTime,
  severity: integer(1, 5),
  category: literal<BanCategory>(BAN_CATEGORIES),
});

const pardonReport: Decoder<PardonReport> = strictObject<PardonReport>({
  kind: literal(["pardon"]),
  clientRef,
  reportId,
  at: unixTime,
});

export const reportRequest: Decoder<ReportRequest> = (input, path) => {
  if (!isRecord(input)) return fail(path, "must be an object");
  switch (input.kind) {
    case "ban":
      return banReport(input, path);
    case "pardon":
      return pardonReport(input, path);
    default:
      return fail(join(path, "kind"), "must be ban or pardon");
  }
};
