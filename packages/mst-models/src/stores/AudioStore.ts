/**
 * Audio store for managing audio capture and transcription
 */

import { types, flow, Instance, SnapshotIn, getRoot } from 'mobx-state-tree';
import { withLoadingState } from '../models/base/mixins';
import { ICaptureMetrics } from '../models/base/types';

/**
 * Capture metrics model
 */
export const CaptureMetrics = types.model('CaptureMetrics', {
  startTimeMs: types.number,
  lastUpdateMs: types.number,
  feedActive: types.boolean,
  sampleRate: types.number,
  bytesReceived: types.number,
  totalSamples: types.number,
  framesProcessed: types.number,
  vadStarts: types.number,
  vadEnds: types.number,
  vadActive: types.boolean,
  segmentsEmitted: types.number,
  lastSegmentSamples: types.number,
  transcriptsEmitted: types.number,
  errors: types.number
})
.views((self) => ({
  get duration() {
    return Date.now() - self.startTimeMs;
  },
  get durationSeconds() {
    return this.duration / 1000;
  },
  get bytesPerSecond() {
    const seconds = this.durationSeconds;
    return seconds > 0 ? self.bytesReceived / seconds : 0;
  },
  get samplesPerSecond() {
    const seconds = this.durationSeconds;
    return seconds > 0 ? self.totalSamples / seconds : 0;
  },
  get errorRate() {
    return self.framesProcessed > 0 ? self.errors / self.framesProcessed : 0;
  }
}));

/**
 * Audio Store
 */
export const AudioStore = types.compose(
  'AudioStore',
  withLoadingState,
  types.model({
    enabled: types.optional(types.boolean, false),
    isCapturing: types.optional(types.boolean, false),
    summary: types.optional(types.string, ''),
    logs: types.optional(types.array(types.string), []),
    status: types.optional(types.string, 'idle'),
    metrics: types.maybeNull(CaptureMetrics),
    // Transcription
    lastTranscript: types.optional(types.string, ''),
    transcriptBuffer: types.optional(types.array(types.string), []),
    // Settings
    maxLogSize: types.optional(types.number, 100),
    metricsUpdateInterval: types.optional(types.number, 3000) // ms
  })
)
.views((self) => ({
  get isIdle() {
    return self.status === 'idle';
  },
  get isActive() {
    return self.isCapturing && self.metrics?.feedActive;
  },
  get hasMetrics() {
    return self.metrics !== null;
  },
  get hasTranscripts() {
    return self.transcriptBuffer.length > 0;
  },
  get transcriptCount() {
    return self.transcriptBuffer.length;
  },
  get logCount() {
    return self.logs.length;
  },
  get recentLogs() {
    return self.logs.slice(-10);
  },
  get allTranscripts() {
    return self.transcriptBuffer.join(' ');
  },
  get captureStats() {
    if (!self.metrics) return null;
    return {
      duration: self.metrics.durationSeconds,
      bytesReceived: self.metrics.bytesReceived,
      transcripts: self.metrics.transcriptsEmitted,
      errors: self.metrics.errors,
      vadActive: self.metrics.vadActive
    };
  }
}))
.actions((self) => ({
  /**
   * Enable/disable audio capture
   */
  setEnabled(enabled: boolean) {
    self.enabled = enabled;
    if (!enabled) {
      this.stopCapture();
    }
  },

  toggleEnabled() {
    this.setEnabled(!self.enabled);
  },

  /**
   * Start audio capture
   */
  startCapture: flow(function* () {
    if (self.isCapturing) return;

    try {
      self.setLoading(true);
      self.isCapturing = true;
      self.status = 'starting';
      self.clearLogs();
      self.clearTranscripts();

      const root = getRoot(self) as any;
      if (root.services?.audio) {
        yield root.services.audio.startCapture();
        self.status = 'capturing';
        self.appendLog('Audio capture started');
      }

      self.setLoading(false);
    } catch (error: any) {
      self.setError(`Failed to start audio capture: ${error.message}`);
      self.isCapturing = false;
      self.status = 'error';
    }
  }),

  /**
   * Stop audio capture
   */
  stopCapture: flow(function* () {
    if (!self.isCapturing) return;

    try {
      self.setLoading(true);
      self.status = 'stopping';

      const root = getRoot(self) as any;
      if (root.services?.audio) {
        yield root.services.audio.stopCapture();
      }

      self.isCapturing = false;
      self.status = 'idle';
      self.metrics = null;
      self.appendLog('Audio capture stopped');
      self.setLoading(false);
    } catch (error: any) {
      self.setError(`Failed to stop audio capture: ${error.message}`);
      self.status = 'error';
    }
  }),

  /**
   * Toggle audio capture
   */
  toggleCapture() {
    if (self.isCapturing) {
      this.stopCapture();
    } else {
      this.startCapture();
    }
  },

  /**
   * Update metrics
   */
  updateMetrics(metrics: ICaptureMetrics) {
    self.metrics = CaptureMetrics.create(metrics);
  },

  /**
   * Clear metrics
   */
  clearMetrics() {
    self.metrics = null;
  },

  /**
   * Set status
   */
  setStatus(status: string) {
    self.status = status;
  },

  /**
   * Update summary
   */
  updateSummary(summary: string) {
    self.summary = summary;
  },

  /**
   * Append summary
   */
  appendSummary(text: string) {
    if (self.summary) {
      self.summary += ' ' + text;
    } else {
      self.summary = text;
    }
  },

  /**
   * Clear summary
   */
  clearSummary() {
    self.summary = '';
  },

  /**
   * Append log message
   */
  appendLog(message: string) {
    const timestamp = new Date().toLocaleTimeString();
    self.logs.push(`[${timestamp}] ${message}`);

    // Trim logs if exceeding max size
    while (self.logs.length > self.maxLogSize) {
      self.logs.shift();
    }
  },

  /**
   * Clear logs
   */
  clearLogs() {
    self.logs.clear();
  },

  /**
   * Handle new transcript
   */
  onTranscript(text: string) {
    self.lastTranscript = text;
    self.transcriptBuffer.push(text);
    self.appendLog(`Transcript: ${text}`);

    // Update summary
    if (text.length > 50) {
      this.appendSummary(text.substring(0, 47) + '...');
    } else {
      this.appendSummary(text);
    }

    // Trigger any callbacks
    const root = getRoot(self) as any;
    if (root.services?.audio?.onTranscript) {
      root.services.audio.onTranscript(text);
    }
  },

  /**
   * Clear transcripts
   */
  clearTranscripts() {
    self.lastTranscript = '';
    self.transcriptBuffer.clear();
  },

  /**
   * Get transcript history
   */
  getTranscriptHistory(limit?: number) {
    if (limit) {
      return self.transcriptBuffer.slice(-limit);
    }
    return [...self.transcriptBuffer];
  },

  /**
   * Handle VAD (Voice Activity Detection) event
   */
  onVADEvent(type: 'start' | 'end') {
    if (type === 'start') {
      self.appendLog('Voice activity detected');
      if (self.metrics) {
        self.metrics.vadActive = true;
        self.metrics.vadStarts++;
      }
    } else {
      self.appendLog('Voice activity ended');
      if (self.metrics) {
        self.metrics.vadActive = false;
        self.metrics.vadEnds++;
      }
    }
  },

  /**
   * Handle error
   */
  onCaptureError(error: string) {
    self.appendLog(`Error: ${error}`);
    if (self.metrics) {
      self.metrics.errors++;
    }
    self.setError(error);
  },

  /**
   * Reset audio state
   */
  reset() {
    this.stopCapture();
    self.clearLogs();
    self.clearTranscripts();
    self.clearSummary();
    self.clearMetrics();
    self.status = 'idle';
  }
}));

// Type exports
export interface IAudioStore extends Instance<typeof AudioStore> {}
export interface IAudioStoreSnapshot extends SnapshotIn<typeof AudioStore> {}
export interface ICaptureMetricsModel extends Instance<typeof CaptureMetrics> {}

// Factory function
export function createAudioStore(): IAudioStore {
  return AudioStore.create({});
}