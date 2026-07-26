// utils/portfolio/index.ts — barrel export for portfolio engines
export { buildTypeProfitability } from './typeProfitability';
export type { TypeProfitRow, TypeProfitabilityResult, TypeProfitabilityCoverage } from './typeProfitability';

export { buildPipelineHorizon } from './pipelineHorizon';
export type { PipelineHorizonInput, PipelineHorizonResult, WinRates, BacklogInfo, LoadWindow } from './pipelineHorizon';

export { buildClientBook, normalizeClientKey } from './clientBook';
export type { ClientRecord, ClientBookResult, COFriction } from './clientBook';

export { buildWeatherSeasonality } from './seasonality';
export type { SeasonalityResult, SeasonalityMonth } from './seasonality';

export { buildPortfolioFactLines, typeProfitabilityFacts, pipelineHorizonFacts, clientBookFacts, seasonalityFacts } from './factLines';
export type { PortfolioFactBlock, PortfolioEngineOutputs } from './factLines';
