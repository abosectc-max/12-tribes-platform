/**
 * Risk Tolerance Questionnaire
 * Assesses investor risk profile and adjusts trading parameters accordingly
 */

const STORAGE_KEY = '12tribes_risk_profiles';

/**
 * Risk profile questions and scoring
 */
const QUESTIONS = [
  {
    id: 'investment_horizon',
    question: 'What is your investment time horizon?',
    options: [
      { label: 'Less than 1 year', score: 1 },
      { label: '1-3 years', score: 2 },
      { label: '3-5 years', score: 3 },
      { label: '5-10 years', score: 4 },
      { label: 'More than 10 years', score: 5 }
    ]
  },
  {
    id: 'loss_tolerance',
    question: 'How would you react to a 20% loss in your portfolio?',
    options: [
      { label: 'Very concerned, would liquidate immediately', score: 1 },
      { label: 'Concerned, but would hold long-term positions', score: 2 },
      { label: 'Neutral, would continue with original plan', score: 3 },
      { label: 'Comfortable, see it as buying opportunity', score: 4 },
      { label: 'Very comfortable, would increase positions', score: 5 }
    ]
  },
  {
    id: 'income_stability',
    question: 'How stable is your primary income?',
    options: [
      { label: 'Very unstable, irregular income', score: 1 },
      { label: 'Somewhat unstable, seasonal variation', score: 2 },
      { label: 'Stable, consistent employment', score: 3 },
      { label: 'Very stable, senior position', score: 4 },
      { label: 'Multiple stable income streams', score: 5 }
    ]
  },
  {
    id: 'investment_experience',
    question: 'What is your investment experience?',
    options: [
      { label: 'No experience, first-time investor', score: 1 },
      { label: 'Limited experience, 1-3 years', score: 2 },
      { label: 'Moderate experience, 3-10 years', score: 3 },
      { label: 'Substantial experience, 10+ years', score: 4 },
      { label: 'Professional investor or trader', score: 5 }
    ]
  },
  {
    id: 'portfolio_preference',
    question: 'What portfolio mix appeals to you most?',
    options: [
      { label: '80% bonds, 20% stocks (conservative)', score: 1 },
      { label: '60% bonds, 40% stocks', score: 2 },
      { label: '50% bonds, 50% stocks (balanced)', score: 3 },
      { label: '40% bonds, 60% stocks', score: 4 },
      { label: '20% bonds, 80% stocks (aggressive)', score: 5 }
    ]
  },
  {
    id: 'market_crash_reaction',
    question: 'In a major market crash, you would:',
    options: [
      { label: 'Move everything to cash for safety', score: 1 },
      { label: 'Reduce stock exposure significantly', score: 2 },
      { label: 'Hold current positions and wait', score: 3 },
      { label: 'Rebalance by buying the dip', score: 4 },
      { label: 'Go all-in and maximum leverage', score: 5 }
    ]
  },
  {
    id: 'return_expectations',
    question: 'What annual return do you realistically expect?',
    options: [
      { label: '2-4% (treasury level)', score: 1 },
      { label: '4-7% (conservative)', score: 2 },
      { label: '7-10% (historical market average)', score: 3 },
      { label: '10-15% (above average)', score: 4 },
      { label: '15%+ (beating the market)', score: 5 }
    ]
  },
  {
    id: 'age_bracket',
    question: 'What is your age?',
    options: [
      { label: '18-25', score: 5 },
      { label: '26-35', score: 4 },
      { label: '36-50', score: 3 },
      { label: '51-65', score: 2 },
      { label: '65+', score: 1 }
    ]
  },
  {
    id: 'net_worth_range',
    question: 'What is your approximate net worth (including this investment)?',
    options: [
      { label: 'Under $100,000', score: 1 },
      { label: '$100,000 - $500,000', score: 2 },
      { label: '$500,000 - $1,000,000', score: 3 },
      { label: '$1,000,000 - $5,000,000', score: 4 },
      { label: 'Over $5,000,000', score: 5 }
    ]
  },
  {
    id: 'risk_comfort',
    question: 'Overall, how comfortable are you with investment risk?',
    options: [
      { label: 'Very conservative, minimal risk', score: 1 },
      { label: 'Conservative, below-average risk', score: 2 },
      { label: 'Moderate, average risk', score: 3 },
      { label: 'Growth-oriented, above-average risk', score: 4 },
      { label: 'Very aggressive, maximum risk tolerance', score: 5 }
    ]
  }
];

/**
 * Risk profiles and their trading parameters
 */
const RISK_PROFILES = {
  conservative: {
    label: 'Conservative',
    scoreRange: [10, 20],
    settings: {
      maxPositionSize: 0.05, // 5% max per position
      maxDrawdownLimit: -5, // Stop trading if portfolio down 5%
      allowedAssetClasses: ['stocks', 'bonds', 'cash'],
      leverageLimit: 0, // No leverage
      stopLossTightness: 0.02, // 2% stop loss
      maxVolatilityTarget: 8, // 8% annual volatility
      rebalanceFrequency: 'monthly',
      dividendReinvest: true,
      hedgingEnabled: true
    }
  },
  moderate: {
    label: 'Moderate',
    scoreRange: [21, 30],
    settings: {
      maxPositionSize: 0.08, // 8% max per position
      maxDrawdownLimit: -10,
      allowedAssetClasses: ['stocks', 'bonds', 'cash', 'etfs'],
      leverageLimit: 0.25, // 25% leverage max
      stopLossTightness: 0.03, // 3% stop loss
      maxVolatilityTarget: 12,
      rebalanceFrequency: 'quarterly',
      dividendReinvest: true,
      hedgingEnabled: true
    }
  },
  growth: {
    label: 'Growth',
    scoreRange: [31, 40],
    settings: {
      maxPositionSize: 0.12, // 12% max per position
      maxDrawdownLimit: -15,
      allowedAssetClasses: ['stocks', 'bonds', 'cash', 'etfs', 'options'],
      leverageLimit: 0.5, // 50% leverage max
      stopLossTightness: 0.05, // 5% stop loss
      maxVolatilityTarget: 16,
      rebalanceFrequency: 'quarterly',
      dividendReinvest: true,
      hedgingEnabled: false
    }
  },
  aggressive: {
    label: 'Aggressive',
    scoreRange: [41, 50],
    settings: {
      maxPositionSize: 0.20, // 20% max per position
      maxDrawdownLimit: -25,
      allowedAssetClasses: ['stocks', 'etfs', 'options', 'futures'],
      leverageLimit: 1.0, // Full leverage allowed
      stopLossTightness: 0.10, // 10% stop loss
      maxVolatilityTarget: 25,
      rebalanceFrequency: 'as-needed',
      dividendReinvest: false,
      hedgingEnabled: false
    }
  }
};

/**
 * Get all questionnaire questions
 * @returns {array} Array of question objects
 */
export function getQuestions() {
  return QUESTIONS;
}

/**
 * Submit questionnaire answers and compute risk profile
 * @param {string} investorId - Investor identifier
 * @param {object} answers - { questionId: selectedOptionIndex }
 * @returns {object} { score, label, settings }
 */
export function submitAnswers(investorId, answers) {
  let totalScore = 0;
  let answeredCount = 0;

  // Validate and score answers
  QUESTIONS.forEach(question => {
    if (answers[question.id] !== undefined) {
      const optionIndex = answers[question.id];
      if (optionIndex >= 0 && optionIndex < question.options.length) {
        totalScore += question.options[optionIndex].score;
        answeredCount++;
      }
    }
  });

  // If not all questions answered, return null
  if (answeredCount < QUESTIONS.length) {
    return null;
  }

  // Determine profile
  const profile = determineProfile(totalScore);

  // Store in localStorage
  const profiles = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  profiles[investorId] = {
    score: totalScore,
    label: profile.label,
    settings: profile.settings,
    completedAt: new Date().toISOString(),
    answers: answers
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));

  return {
    score: totalScore,
    label: profile.label,
    settings: profile.settings
  };
}

/**
 * Get investor's risk profile
 * @param {string} investorId - Investor identifier
 * @returns {object|null} Risk profile or null if not completed
 */
export function getRiskProfile(investorId) {
  const profiles = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  return profiles[investorId] || null;
}

/**
 * Get default settings for a risk profile label
 * @param {string} profileLabel - Profile label (conservative, moderate, growth, aggressive)
 * @returns {object} Trading settings
 */
export function getDefaultSettings(profileLabel) {
  const profile = Object.values(RISK_PROFILES).find(p => p.label.toLowerCase() === profileLabel.toLowerCase());
  return profile ? profile.settings : RISK_PROFILES.moderate.settings;
}

/**
 * Check if investor has completed questionnaire
 * @param {string} investorId - Investor identifier
 * @returns {boolean}
 */
export function hasCompletedQuestionnaire(investorId) {
  const profiles = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  return !!profiles[investorId];
}

/**
 * Reset questionnaire for investor (allow retake)
 * @param {string} investorId - Investor identifier
 */
export function resetQuestionnaire(investorId) {
  const profiles = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  delete profiles[investorId];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

/**
 * Get all available risk profiles
 * @returns {array} Array of profile objects with labels and descriptions
 */
export function getAvailableProfiles() {
  return Object.entries(RISK_PROFILES).map(([key, profile]) => ({
    key: key,
    label: profile.label,
    scoreRange: profile.scoreRange,
    description: getProfileDescription(key),
    settings: profile.settings
  }));
}

/**
 * Determine profile based on total score
 * @private
 * @param {number} score - Total questionnaire score
 * @returns {object} Profile object
 */
function determineProfile(score) {
  if (score <= 20) return RISK_PROFILES.conservative;
  if (score <= 30) return RISK_PROFILES.moderate;
  if (score <= 40) return RISK_PROFILES.growth;
  return RISK_PROFILES.aggressive;
}

/**
 * Get human-readable profile description
 * @private
 * @param {string} profileKey - Profile key
 * @returns {string} Description
 */
function getProfileDescription(profileKey) {
  const descriptions = {
    conservative: 'Prioritizes capital preservation with minimal volatility. Suitable for investors nearing retirement or with low risk tolerance.',
    moderate: 'Balanced approach between growth and stability. Suitable for most investors with medium-term horizons and moderate risk tolerance.',
    growth: 'Emphasizes growth potential with higher volatility acceptance. Suitable for younger investors with longer time horizons.',
    aggressive: 'Maximum growth focus with high leverage and volatility. Suitable for experienced traders with high risk tolerance and long-term horizons.'
  };
  return descriptions[profileKey] || '';
}

/**
 * Get investor's current trading parameters based on risk profile
 * @param {string} investorId - Investor identifier
 * @returns {object} Trading parameters
 */
export function getTradingParameters(investorId) {
  const profile = getRiskProfile(investorId);
  if (!profile) {
    // Return moderate defaults if no profile
    return RISK_PROFILES.moderate.settings;
  }
  return profile.settings;
}

/**
 * Validate a proposed trade against risk parameters
 * @param {string} investorId - Investor identifier
 * @param {object} trade - { symbol, quantity, price, portfolioValue }
 * @returns {object} { allowed: boolean, reasons: array }
 */
export function validateTrade(investorId, trade) {
  const parameters = getTradingParameters(investorId);
  const tradeValue = trade.quantity * trade.price;
  const positionPercent = tradeValue / trade.portfolioValue;
  const reasons = [];
  let allowed = true;

  // Check position size limit
  if (positionPercent > parameters.maxPositionSize) {
    allowed = false;
    reasons.push(`Position size ${(positionPercent * 100).toFixed(1)}% exceeds limit of ${(parameters.maxPositionSize * 100).toFixed(1)}%`);
  }

  return {
    allowed,
    reasons,
    positionPercent,
    maxAllowed: parameters.maxPositionSize
  };
}

/**
 * Export all questionnaire data for an investor
 * @param {string} investorId - Investor identifier
 * @returns {object} Complete questionnaire data and results
 */
export function exportQuestionnaireData(investorId) {
  const profile = getRiskProfile(investorId);
  if (!profile) return null;

  return {
    investorId,
    completedAt: profile.completedAt,
    riskProfile: {
      score: profile.score,
      label: profile.label,
      description: getProfileDescription(profile.label.toLowerCase())
    },
    settings: profile.settings,
    answers: mapAnswersToText(profile.answers)
  };
}

/**
 * Convert numeric answers to readable text
 * @private
 * @param {object} answers - { questionId: optionIndex }
 * @returns {object} { questionId: selectedText }
 */
function mapAnswersToText(answers) {
  const result = {};
  Object.entries(answers).forEach(([questionId, optionIndex]) => {
    const question = QUESTIONS.find(q => q.id === questionId);
    if (question && optionIndex < question.options.length) {
      result[questionId] = question.options[optionIndex].label;
    }
  });
  return result;
}
