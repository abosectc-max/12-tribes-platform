/**
 * notificationService.js
 * Real-time notification system for 12 Tribes AI investment platform
 *
 * Features:
 * - In-app notification queue with toast-style display
 * - Priority levels: info, success, warning, critical
 * - Categories: trade_execution, risk_alert, agent_signal, withdrawal, system, price_alert
 * - Configurable alert rules with condition checking
 * - Sound toggle (preference storage)
 * - Notification history with read/unread status
 * - Badge count for unread notifications
 * - Auto-dismiss timers
 * - Max 100 notifications with oldest pruning
 */

const STORAGE_KEYS = {
  NOTIFICATIONS: '12tribes_notifications',
  ALERT_RULES: '12tribes_alert_rules',
  NOTIFICATION_PREFS: '12tribes_notification_prefs',
};

const NOTIFICATION_TYPES = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  CRITICAL: 'critical',
};

const NOTIFICATION_CATEGORIES = {
  TRADE_EXECUTION: 'trade_execution',
  RISK_ALERT: 'risk_alert',
  AGENT_SIGNAL: 'agent_signal',
  WITHDRAWAL: 'withdrawal',
  SYSTEM: 'system',
  PRICE_ALERT: 'price_alert',
};

const PRIORITY_LEVELS = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  CRITICAL: 'critical',
};

const AUTO_DISMISS_TIMERS = {
  info: 5000,
  success: 5000,
  warning: 10000,
  critical: null, // Manual dismiss
};

const MAX_NOTIFICATIONS = 100;

/**
 * Initialize default preferences
 */
function getDefaultPreferences() {
  return {
    soundEnabled: true,
    notificationEnabled: true,
    categoryPreferences: {
      trade_execution: true,
      risk_alert: true,
      agent_signal: true,
      withdrawal: true,
      system: true,
      price_alert: true,
    },
    typePreferences: {
      info: true,
      success: true,
      warning: true,
      critical: true,
    },
    autoMarkAsRead: false,
    persistHistory: true,
  };
}

/**
 * Get all notifications from storage
 */
function getAllNotifications() {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to retrieve notifications:', error);
    return [];
  }
}

/**
 * Save notifications to storage
 */
function saveNotifications(notifications) {
  try {
    // Prune if exceeds max
    const pruned = notifications.slice(-MAX_NOTIFICATIONS);
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(pruned));
  } catch (error) {
    console.error('Failed to save notifications:', error);
  }
}

/**
 * Get all alert rules from storage
 */
function getAllAlertRules() {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.ALERT_RULES);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to retrieve alert rules:', error);
    return [];
  }
}

/**
 * Save alert rules to storage
 */
function saveAlertRules(rules) {
  try {
    localStorage.setItem(STORAGE_KEYS.ALERT_RULES, JSON.stringify(rules));
  } catch (error) {
    console.error('Failed to save alert rules:', error);
  }
}

/**
 * Get notification preferences from storage
 */
function getStoredPreferences() {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.NOTIFICATION_PREFS);
    if (stored) {
      return { ...getDefaultPreferences(), ...JSON.parse(stored) };
    }
    return getDefaultPreferences();
  } catch (error) {
    console.error('Failed to retrieve preferences:', error);
    return getDefaultPreferences();
  }
}

/**
 * Save notification preferences to storage
 */
function savePreferences(prefs) {
  try {
    localStorage.setItem(STORAGE_KEYS.NOTIFICATION_PREFS, JSON.stringify(prefs));
  } catch (error) {
    console.error('Failed to save preferences:', error);
  }
}

/**
 * Generate unique notification ID
 */
function generateNotificationId() {
  return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a notification object
 */
function createNotification(options) {
  const {
    title,
    message,
    type = NOTIFICATION_TYPES.INFO,
    category = NOTIFICATION_CATEGORIES.SYSTEM,
    priority = PRIORITY_LEVELS.NORMAL,
    data = null,
  } = options;

  return {
    id: generateNotificationId(),
    title,
    message,
    type,
    category,
    priority,
    data,
    read: false,
    createdAt: new Date().toISOString(),
    autoDismissTime: AUTO_DISMISS_TIMERS[type],
  };
}

/**
 * Add a notification to the queue
 * @param {Object} notification - { title, message, type, category, priority, data? }
 */
export function notify(notification) {
  const prefs = getStoredPreferences();

  // Check if notification type is enabled
  if (!prefs.typePreferences[notification.type]) {
    return null;
  }

  // Check if category is enabled
  if (!prefs.categoryPreferences[notification.category]) {
    return null;
  }

  const newNotif = createNotification(notification);
  const notifications = getAllNotifications();
  notifications.push(newNotif);
  saveNotifications(notifications);

  return newNotif;
}

/**
 * Get paginated notifications
 * @param {number} limit - Results per page
 * @param {number} offset - Pagination offset
 * @returns {Array} Notifications
 */
export function getNotifications(limit = 20, offset = 0) {
  const notifications = getAllNotifications();
  return notifications
    .reverse()
    .slice(offset, offset + limit);
}

/**
 * Get unread notification count
 * @returns {number} Count of unread notifications
 */
export function getUnreadCount() {
  const notifications = getAllNotifications();
  return notifications.filter(n => !n.read).length;
}

/**
 * Mark a single notification as read
 * @param {string} notificationId - Notification ID
 */
export function markRead(notificationId) {
  const notifications = getAllNotifications();
  const notif = notifications.find(n => n.id === notificationId);

  if (notif) {
    notif.read = true;
    saveNotifications(notifications);
  }
}

/**
 * Mark all notifications as read
 */
export function markAllRead() {
  const notifications = getAllNotifications();
  notifications.forEach(n => {
    n.read = true;
  });
  saveNotifications(notifications);
}

/**
 * Clear all notifications
 */
export function clearNotifications() {
  localStorage.removeItem(STORAGE_KEYS.NOTIFICATIONS);
}

/**
 * Add an alert rule
 * @param {Object} rule - { condition, threshold, action, enabled }
 * @returns {Object} Created rule with ID
 */
export function addAlertRule(rule) {
  const rules = getAllAlertRules();
  const newRule = {
    id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    condition: rule.condition, // e.g., 'price_crosses', 'pnl_hits_target', 'drawdown_exceeds'
    threshold: rule.threshold, // Threshold value
    action: rule.action, // e.g., { notificationType: 'warning', title: '...', message: '...' }
    enabled: rule.enabled !== false,
    createdAt: new Date().toISOString(),
    lastTriggeredAt: null,
  };

  rules.push(newRule);
  saveAlertRules(rules);

  return newRule;
}

/**
 * Get all alert rules
 * @returns {Array} All alert rules
 */
export function getAlertRules() {
  return getAllAlertRules();
}

/**
 * Update an alert rule
 * @param {string} ruleId - Rule ID
 * @param {Object} updates - Fields to update
 */
export function updateAlertRule(ruleId, updates) {
  const rules = getAllAlertRules();
  const rule = rules.find(r => r.id === ruleId);

  if (rule) {
    Object.assign(rule, updates);
    saveAlertRules(rules);
  }
}

/**
 * Delete an alert rule
 * @param {string} ruleId - Rule ID
 */
export function deleteAlertRule(ruleId) {
  const rules = getAllAlertRules();
  const filtered = rules.filter(r => r.id !== ruleId);
  saveAlertRules(filtered);
}

/**
 * Check all alert rules against market data
 * @param {Object} marketData - Current market data { symbol, price, pnl, drawdown, ... }
 */
export function checkAlertRules(marketData) {
  const rules = getAllAlertRules().filter(r => r.enabled);
  const triggered = [];

  rules.forEach(rule => {
    let shouldFire = false;

    if (rule.condition === 'price_crosses') {
      // Check if price crossed threshold
      const { symbol, price, previousPrice } = marketData;
      if (previousPrice && symbol === rule.data?.symbol) {
        shouldFire =
          (previousPrice < rule.threshold && price >= rule.threshold) ||
          (previousPrice > rule.threshold && price <= rule.threshold);
      }
    } else if (rule.condition === 'pnl_hits_target') {
      // Check if P&L hit target
      if (marketData.pnl !== undefined) {
        shouldFire =
          (rule.data?.direction === 'above' && marketData.pnl >= rule.threshold) ||
          (rule.data?.direction === 'below' && marketData.pnl <= rule.threshold);
      }
    } else if (rule.condition === 'drawdown_exceeds') {
      // Check if drawdown exceeds limit
      if (marketData.drawdown !== undefined) {
        shouldFire = Math.abs(marketData.drawdown) > rule.threshold;
      }
    }

    if (shouldFire) {
      const notif = notify(rule.action);
      triggered.push(rule.id);

      // Update last triggered time
      updateAlertRule(rule.id, {
        lastTriggeredAt: new Date().toISOString(),
      });
    }
  });

  return triggered;
}

/**
 * Get notification preferences
 * @returns {Object} User preferences
 */
export function getNotificationPreferences() {
  return getStoredPreferences();
}

/**
 * Update notification preferences
 * @param {Object} prefs - Preferences to update
 */
export function updateNotificationPreferences(prefs) {
  const current = getStoredPreferences();
  const updated = { ...current, ...prefs };
  savePreferences(updated);
  return updated;
}

/**
 * Export constants for use in UI
 */
export const NotificationConstants = {
  TYPES: NOTIFICATION_TYPES,
  CATEGORIES: NOTIFICATION_CATEGORIES,
  PRIORITIES: PRIORITY_LEVELS,
};
