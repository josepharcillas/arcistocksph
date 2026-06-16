// PSEi 30 constituents (seed data — sectors are simplified; verify against the
// current index composition periodically). Used to enrich the screener with
// sector info, since phisix returns only price/volume.
export interface Psei30Stock {
  ticker: string;
  name: string;
  sector: 'Holding' | 'Property' | 'Financials' | 'Industrial' | 'Services' | 'Mining';
}

export const PSEI30: Psei30Stock[] = [
  { ticker: 'AC', name: 'Ayala Corporation', sector: 'Holding' },
  { ticker: 'ACEN', name: 'ACEN Corporation', sector: 'Industrial' },
  { ticker: 'AEV', name: 'Aboitiz Equity Ventures', sector: 'Holding' },
  { ticker: 'AGI', name: 'Alliance Global Group', sector: 'Holding' },
  { ticker: 'ALI', name: 'Ayala Land', sector: 'Property' },
  { ticker: 'AP', name: 'Aboitiz Power', sector: 'Industrial' },
  { ticker: 'BDO', name: 'BDO Unibank', sector: 'Financials' },
  { ticker: 'BPI', name: 'Bank of the Philippine Islands', sector: 'Financials' },
  { ticker: 'BLOOM', name: 'Bloomberry Resorts', sector: 'Services' },
  { ticker: 'CNVRG', name: 'Converge ICT Solutions', sector: 'Services' },
  { ticker: 'DMC', name: 'DMCI Holdings', sector: 'Holding' },
  { ticker: 'EMI', name: 'Emperador Inc.', sector: 'Industrial' },
  { ticker: 'GLO', name: 'Globe Telecom', sector: 'Services' },
  { ticker: 'GTCAP', name: 'GT Capital Holdings', sector: 'Holding' },
  { ticker: 'ICT', name: 'International Container Terminal Services', sector: 'Services' },
  { ticker: 'JFC', name: 'Jollibee Foods', sector: 'Services' },
  { ticker: 'JGS', name: 'JG Summit Holdings', sector: 'Holding' },
  { ticker: 'LTG', name: 'LT Group', sector: 'Holding' },
  { ticker: 'MBT', name: 'Metropolitan Bank & Trust', sector: 'Financials' },
  { ticker: 'MER', name: 'Manila Electric Company', sector: 'Industrial' },
  { ticker: 'MONDE', name: 'Monde Nissin', sector: 'Industrial' },
  { ticker: 'NIKL', name: 'Nickel Asia Corporation', sector: 'Mining' },
  { ticker: 'PGOLD', name: 'Puregold Price Club', sector: 'Services' },
  { ticker: 'RRHI', name: 'Robinsons Retail Holdings', sector: 'Services' },
  { ticker: 'SCC', name: 'Semirara Mining and Power', sector: 'Mining' },
  { ticker: 'SM', name: 'SM Investments', sector: 'Holding' },
  { ticker: 'SMC', name: 'San Miguel Corporation', sector: 'Holding' },
  { ticker: 'SMPH', name: 'SM Prime Holdings', sector: 'Property' },
  { ticker: 'TEL', name: 'PLDT Inc.', sector: 'Services' },
  { ticker: 'URC', name: 'Universal Robina', sector: 'Industrial' },
];

export const SECTORS = ['Holding', 'Property', 'Financials', 'Industrial', 'Services', 'Mining'] as const;

export const SECTOR_BY_TICKER: Record<string, string> = Object.fromEntries(
  PSEI30.map((s) => [s.ticker, s.sector]),
);
