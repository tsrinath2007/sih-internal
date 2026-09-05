/**
 * Parallax IndexedDB Local Logging & Metrics Storage
 *
 * ============================================================================
 * STRICT LOCAL-ONLY PRIVACY POLICY:
 * This module is 100% local. It never sends data over the network.
 * It exists solely to power in-browser metrics and local demo audit logs.
 *
 * CRITICAL DATA RULE:
 * Each log entry must ONLY contain structural detection metadata:
 * - id (auto-increment)
 * - pageUrl (string)
 * - timestamp (ISO string)
 * - detections: [{ type, confidence, bbox }]
 * - redactedCount (number)
 * - blocked (boolean)
 * - actionType ("summarize" | "fill_field" | null)
 * - actionApproved (boolean | null)
 *
 * NEVER STORE:
 * - Matched text / raw sensitive values (email, phone, card numbers, OTP, etc.)
 * - Screenshot images or canvas image data
 * - Raw or sanitized OCR text
 * - Any DOM page contents or user keystrokes
 * ============================================================================
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ParallaxDB = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const DB_NAME = 'ParallaxDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'detectionLogs';

  let dbPromise = null;

  /**
   * Initialize IndexedDB and create object store with indexes
   */
  function initDB() {
    if (dbPromise) return dbPromise;

    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB not available in current context'));
    }

    dbPromise = new Promise((resolve, reject) => {
      let isSettled = false;
      const timeoutTimer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          reject(new Error('IndexedDB open timed out after 3000ms'));
        }
      }, 3000);

      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.createIndex('blocked', 'blocked', { unique: false });
          }
        };

        request.onsuccess = (event) => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timeoutTimer);
            resolve(event.target.result);
          }
        };

        request.onerror = (event) => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timeoutTimer);
            console.warn('[ParallaxDB] Failed to open IndexedDB:', event.target.error);
            reject(event.target.error);
          }
        };
      } catch (err) {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeoutTimer);
          reject(err);
        }
      }
    });

    return dbPromise;
  }

  /**
   * Sanitize an entry to strictly ensure no raw sensitive text or images are logged
   */
  function sanitizeForLog(rawEntry) {
    const cleanDetections = (rawEntry.detections || []).map(d => ({
      type: d.type || 'UNKNOWN',
      confidence: typeof d.confidence === 'number' ? Number(d.confidence.toFixed(1)) : 90,
      bbox: {
        x: d.bbox ? Math.round(d.bbox.x || 0) : 0,
        y: d.bbox ? Math.round(d.bbox.y || 0) : 0,
        width: d.bbox ? Math.round(d.bbox.width || 0) : 0,
        height: d.bbox ? Math.round(d.bbox.height || 0) : 0
      }
    }));

    return {
      pageUrl: typeof rawEntry.pageUrl === 'string' ? rawEntry.pageUrl : 'unknown',
      timestamp: rawEntry.timestamp || new Date().toISOString(),
      detections: cleanDetections,
      redactedCount: typeof rawEntry.redactedCount === 'number' ? rawEntry.redactedCount : cleanDetections.length,
      blocked: Boolean(rawEntry.blocked),
      actionType: rawEntry.actionType || null,
      actionApproved: rawEntry.actionApproved != null ? Boolean(rawEntry.actionApproved) : null
    };
  }

  /**
   * Add a new detection log entry
   * @param {Object} rawEntry
   * @returns {Promise<number>} Returns the auto-incremented log ID
   */
  async function addLog(rawEntry) {
    const db = await initDB();
    const cleanEntry = sanitizeForLog(rawEntry);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(cleanEntry);

      request.onsuccess = (event) => {
        resolve(event.target.result); // log ID
      };

      request.onerror = (event) => {
        console.error('[ParallaxDB] Error adding log entry:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Update an existing detection log entry (e.g. after approval/rejection)
   * @param {number} id - The ID of the existing log entry
   * @param {Object} updateFields - { actionType, actionApproved }
   */
  async function updateLog(id, updateFields = {}) {
    if (id == null) return null;
    const db = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (!record) {
          resolve(null);
          return;
        }

        if (updateFields.actionType !== undefined) {
          record.actionType = updateFields.actionType;
        }
        if (updateFields.actionApproved !== undefined) {
          record.actionApproved = updateFields.actionApproved;
        }
        if (updateFields.blocked !== undefined) {
          record.blocked = Boolean(updateFields.blocked);
        }

        const putRequest = store.put(record);
        putRequest.onsuccess = () => resolve(record);
        putRequest.onerror = (event) => reject(event.target.error);
      };

      getRequest.onerror = (event) => reject(event.target.error);
    });
  }

  /**
   * Retrieve all stored detection logs, sorted chronologically (newest first)
   * @returns {Promise<Array>}
   */
  async function getAllLogs() {
    const db = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const logs = request.result || [];
        logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        resolve(logs);
      };

      request.onerror = (event) => reject(event.target.error);
    });
  }

  /**
   * Compute aggregate detection and action metrics for pitch deck / demo presentation
   * @returns {Promise<Object>}
   */
  async function getLogsSummary() {
    const logs = await getAllLogs();

    const summary = {
      totalScans: logs.length,
      totalPIIDetected: 0,
      totalBlocked: 0,
      totalApproved: 0,
      totalRejected: 0,
      byType: {
        EMAIL: 0,
        PHONE: 0,
        OTP: 0,
        CARD: 0
      }
    };

    for (const log of logs) {
      if (log.blocked) summary.totalBlocked++;
      if (log.actionApproved === true) summary.totalApproved++;
      if (log.actionApproved === false) summary.totalRejected++;

      for (const d of (log.detections || [])) {
        summary.totalPIIDetected++;
        if (summary.byType[d.type] != null) {
          summary.byType[d.type]++;
        } else {
          summary.byType[d.type] = 1;
        }
      }
    }

    return summary;
  }

  /**
   * Clear all detection history from IndexedDB
   */
  async function clearLogs() {
    const db = await initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve(true);
      request.onerror = (event) => reject(event.target.error);
    });
  }

  return {
    initDB,
    addLog,
    updateLog,
    getAllLogs,
    getLogsSummary,
    clearLogs
  };
}));
