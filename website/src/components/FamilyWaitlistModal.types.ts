// Shared types + option catalogs for the FamilyWaitlistModal.
// Option `value` strings match exactly what the backend whitelists and persists.

export type SurveyData = {
  gender?: string;
  ageRange?: string;
  familyStatus?: string;
  numberOfKids?: number;
  jointSavingsAccount?: boolean;
  savingsMethods?: string[];
  monthlySavingsAmount?: string;
  cryptoComfort?: string;
  defiProtocols?: string[];
  currentGoals?: string[];
  futureGoals?: string[];
  savingsChallenge?: string;
};

export type Option = { value: string; label: string };

export const GENDER_OPTIONS: Option[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'non-binary', label: 'Non-binary' },
  { value: 'prefer-not', label: 'Prefer not to say' },
];

export const AGE_OPTIONS: Option[] = [
  { value: '18-24', label: '18–24' },
  { value: '25-34', label: '25–34' },
  { value: '35-44', label: '35–44' },
  { value: '45-54', label: '45–54' },
  { value: '55+',   label: '55+' },
  { value: 'prefer-not', label: 'Prefer not to say' },
];

export const FAMILY_STATUS_OPTIONS: Option[] = [
  { value: 'single',   label: 'Single' },
  { value: 'dating',   label: 'Dating' },
  { value: 'married',  label: 'Married' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed',  label: 'Widowed' },
];

export const SAVINGS_METHODS_OPTIONS: Option[] = [
  { value: 'bank-deposit', label: 'Bank deposit / HYSA' },
  { value: 'stocks',       label: 'Stocks / ETFs' },
  { value: 'gold-metals',  label: 'Gold & precious metals' },
  { value: 'real-estate',  label: 'Real estate' },
  { value: 'cash',         label: 'Cash at home' },
  { value: 'crypto',       label: 'Crypto' },
  { value: 'none',         label: "I'm not saving yet" },
];

export const MONTHLY_SAVINGS_OPTIONS: Option[] = [
  { value: 'under-100',  label: 'Under $100' },
  { value: '100-500',    label: '$100–500' },
  { value: '500-1000',   label: '$500–1,000' },
  { value: '1000-2500',  label: '$1,000–2,500' },
  { value: '2500+',      label: '$2,500+' },
  { value: 'varies',     label: 'It varies a lot' },
  { value: 'none',       label: "I'm not saving right now" },
];

export const CRYPTO_COMFORT_OPTIONS: Option[] = [
  { value: 'never-used', label: "Never used crypto" },
  { value: 'dabbled',    label: 'Dabbled a bit' },
  { value: 'regular',    label: 'Use it regularly' },
  { value: 'advanced',   label: 'Advanced — bridges, DeFi, the works' },
  { value: 'pro',        label: "Pro — I'm deep in the ecosystem" },
];

export const DEFI_PROTOCOLS_OPTIONS: Option[] = [
  { value: 'jupiter',  label: 'Jupiter' },
  { value: 'kamino',   label: 'Kamino' },
  { value: 'drift',    label: 'Drift' },
  { value: 'marginfi', label: 'MarginFi' },
  { value: 'aave',     label: 'Aave' },
  { value: 'uniswap',  label: 'Uniswap' },
  { value: 'morpho',   label: 'Morpho' },
  { value: 'other',    label: 'Other' },
  { value: 'none',     label: 'None yet' },
];

export const GOAL_OPTIONS: Option[] = [
  { value: 'new-car',        label: 'New car' },
  { value: 'new-home',       label: 'New home' },
  { value: 'family-trip',    label: 'Family trip' },
  { value: 'emergency-fund', label: 'Emergency fund' },
  { value: 'kids-college',   label: "Kids' college" },
  { value: 'retirement',     label: 'Retirement' },
  { value: 'wedding',        label: 'Wedding' },
  { value: 'debt-payoff',    label: 'Paying off debt' },
];

export const CHALLENGE_OPTIONS: Option[] = [
  { value: 'no-discipline',  label: 'I lack discipline — I spend what I save' },
  { value: 'high-expenses',  label: 'My expenses are too high' },
  { value: 'low-income',     label: 'My income is too low right now' },
  { value: 'dont-know-where', label: "I don't know where to start" },
  { value: 'fear',           label: "I'm afraid to invest and lose it" },
  { value: 'no-time',        label: "I don't have time to manage it" },
];
