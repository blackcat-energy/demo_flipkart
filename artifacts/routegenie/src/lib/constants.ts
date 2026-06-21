export const RISK_PALETTE = {
  SAFE: '#16A34A',      // < 30
  MODERATE: '#D97706',  // 30 - 50
  HIGH: '#EA580C',      // 50 - 70
  CRITICAL: '#DC2626'   // > 70
};

export function getRiskColor(score: number): string {
  if (score < 30) return RISK_PALETTE.SAFE;
  if (score < 50) return RISK_PALETTE.MODERATE;
  if (score < 70) return RISK_PALETTE.HIGH;
  return RISK_PALETTE.CRITICAL;
}

export function getRiskLabel(score: number): string {
  if (score < 30) return 'Low';
  if (score < 50) return 'Moderate';
  if (score < 70) return 'High';
  return 'Critical';
}

export const EVENT_TYPES = [
  'Political Rally',
  'Festival/Procession',
  'Sports Event',
  'VIP Movement',
  'Construction',
  'Protest',
  'Accident',
  'Vehicle Breakdown',
  'Water Logging',
  'Tree Fall',
  'Road Conditions',
  'Other'
];

export const CROWD_ESTIMATES = [
  '<500',
  '500–2000',
  '2000–10000',
  '10000+'
];
