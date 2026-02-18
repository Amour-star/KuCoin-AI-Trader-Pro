CREATE TYPE "EngineMode" AS ENUM ('PAPER', 'LIVE');
CREATE TYPE "DecisionType" AS ENUM ('BUY', 'SELL', 'HOLD');
CREATE TYPE "TradeStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELED');
CREATE TYPE "PositionStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "EngineState" (
  "id" TEXT PRIMARY KEY DEFAULT 'singleton',
  "mode" "EngineMode" NOT NULL DEFAULT 'PAPER',
  "autoPaper" BOOLEAN NOT NULL DEFAULT true,
  "confidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Decision" (
  "id" TEXT PRIMARY KEY,
  "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "symbol" TEXT NOT NULL,
  "timeframe" TEXT NOT NULL,
  "decision" "DecisionType" NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "reasons" JSONB NOT NULL,
  "featuresHash" TEXT NOT NULL,
  "modelVersion" TEXT NOT NULL
);

CREATE TABLE "Trade" (
  "id" TEXT PRIMARY KEY,
  "tsOpen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tsClose" TIMESTAMP(3),
  "symbol" TEXT NOT NULL,
  "side" "DecisionType" NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL,
  "entryPrice" DOUBLE PRECISION NOT NULL,
  "exitPrice" DOUBLE PRECISION,
  "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "slPrice" DOUBLE PRECISION,
  "tpPrice" DOUBLE PRECISION,
  "slippage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "pnlAbs" DOUBLE PRECISION,
  "pnlPct" DOUBLE PRECISION,
  "status" "TradeStatus" NOT NULL DEFAULT 'OPEN',
  "decisionId" TEXT REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Position" (
  "id" TEXT PRIMARY KEY,
  "symbol" TEXT NOT NULL,
  "side" "DecisionType" NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL,
  "avgEntry" DOUBLE PRECISION NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "status" "PositionStatus" NOT NULL DEFAULT 'OPEN'
);

CREATE INDEX "Decision_symbol_ts_idx" ON "Decision"("symbol", "ts");
CREATE INDEX "Trade_symbol_status_tsOpen_idx" ON "Trade"("symbol", "status", "tsOpen");
CREATE INDEX "Position_symbol_status_idx" ON "Position"("symbol", "status");
