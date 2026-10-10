import type { AgentJob, AgentProgress } from "@/types/content_generator";
import { API_BASE, auth_headers, response_error } from "@/services/api_core";

export interface AgentState {
  job: AgentJob | null;
  progress: AgentProgress;
}

export class AgentStateProtocolError extends Error {}

type Subscriber = {
  jobId?: string;
  onState: (state: AgentState) => void;
  onError?: (error: Error, fatal: boolean) => void;
};

export async function fetch_agent_state(sessionId: string, signal: AbortSignal, jobId?: string): Promise<AgentState> {
  const query = jobId ? `?job_id=${encodeURIComponent(jobId)}` : "";
  const response = await fetch(
    `${API_BASE}/api/v1/content_generator/sessions/${encodeURIComponent(sessionId)}/agent-state${query}`,
    { headers: auth_headers(), signal, cache: "no-store" },
  );
  if (!response.ok) {
    const error = await response_error(response, "Could not load Agent task");
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      throw new AgentStateProtocolError(error.message);
    }
    throw error;
  }
  const body: { data: AgentState } = await response.json();
  const state = body.data;
  if (!state?.progress || !Number.isFinite(state.progress.revision)
    || (jobId && state.job?.id !== jobId)
    || (state.job && (state.progress.job_id !== state.job.id || ![
      "queued", "running", "cancelling", "succeeded", "failed", "cancelled", "interrupted", "timed_out",
    ].includes(state.job.status)))) {
    throw new AgentStateProtocolError("Agent task returned an invalid result");
  }
  return state;
}

// One serial request loop per session, shared by the canvas and durable job waiters.
export function createAgentStateObserver(options: {
  fetchState?: typeof fetch_agent_state;
  activeDelay?: number;
  quietDelay?: number;
  idleDelay?: number;
  timeout?: number;
  hidden?: () => boolean;
} = {}) {
  const streams = new Map<string, {
    subscribers: Set<Subscriber>;
    timer?: ReturnType<typeof setTimeout>;
    request?: AbortController;
    generation: number;
    revision: number;
    fingerprint: string;
    latestFingerprint: string;
    delay: number;
    failures: number;
    cursor: number;
    missingJobs: string[];
    jobRevisions: Map<string, number>;
    latestJobId?: string;
    latestActive: boolean;
  }>();
  const activeDelay = options.activeDelay ?? 500;
  const quietDelay = options.quietDelay ?? 1500;
  const idleDelay = options.idleDelay ?? 5000;
  const hidden = options.hidden ?? (() => typeof document !== "undefined" && document.visibilityState === "hidden");
  const fetchState = options.fetchState ?? fetch_agent_state;

  function subscribe(sessionId: string, subscriber: Subscriber): () => void {
    let stream = streams.get(sessionId);
    if (!stream) {
      stream = {
        subscribers: new Set(), generation: 0, revision: -1, fingerprint: "", latestFingerprint: "",
        delay: activeDelay, failures: 0, cursor: 0,
        missingJobs: [], jobRevisions: new Map(), latestActive: false,
      };
      streams.set(sessionId, stream);
    }
    const current = stream;
    current.subscribers.add(subscriber);

    const schedule = (delay: number) => {
      if (!current.subscribers.size || current.request || current.timer) return;
      current.timer = setTimeout(() => {
        current.timer = undefined;
        void poll();
      }, delay);
    };
    const poll = async () => {
      if (!current.subscribers.size || current.request) return;
      const generation = current.generation;
      const controller = new AbortController();
      current.request = controller;
      const jobIds = [...new Set([...current.subscribers].flatMap(item => item.jobId ? [item.jobId] : []))];
      const observingLatest = [...current.subscribers].some(item => !item.jobId);
      const missingJob = current.missingJobs.shift();
      const jobId = observingLatest
        ? missingJob && jobIds.includes(missingJob) ? missingJob : undefined
        : jobIds.length ? jobIds[current.cursor++ % jobIds.length] : undefined;
      const timeout = setTimeout(() => controller.abort(new Error("Agent status request timed out")), options.timeout ?? 10000);
      let delay = activeDelay;
      try {
        const state = await fetchState(sessionId, controller.signal, jobId);
        if (generation !== current.generation || !current.subscribers.size) return;
        if (controller.signal.aborted) throw controller.signal.reason;
        if (!Number.isFinite(state.progress.revision) || (jobId && state.job?.id !== jobId)) {
          throw new AgentStateProtocolError("Agent task returned an invalid result");
        }
        current.failures = 0;
        const fingerprint = JSON.stringify([state.job, { ...state.progress, revision: undefined }]);
        const changed = fingerprint !== current.fingerprint;
        const revision = jobId ? current.jobRevisions.get(jobId) ?? -1 : current.revision;
        const accepted = state.progress.revision > revision
          || (state.progress.revision === revision && (jobId || fingerprint === current.latestFingerprint));
        if (accepted) {
          if (!jobId) {
            current.revision = state.progress.revision;
            current.latestFingerprint = fingerprint;
            current.latestJobId = state.job?.id;
            current.latestActive = Boolean(state.job && ["queued", "running", "cancelling"].includes(state.job.status));
            current.missingJobs = jobIds.filter(id => id !== state.job?.id);
          }
          if (state.job) current.jobRevisions.set(state.job.id, state.progress.revision);
          current.fingerprint = fingerprint;
          for (const item of [...current.subscribers]) {
            if (generation !== current.generation) break;
            const matches = item.jobId
              ? item.jobId === state.job?.id
              : !jobId || current.latestJobId === state.job?.id;
            if (current.subscribers.has(item) && matches) item.onState(state);
          }
        }
        const active = (state.job && ["queued", "running", "cancelling"].includes(state.job.status))
          || (jobId && observingLatest && current.latestActive);
        delay = active
          ? changed ? activeDelay : Math.min(quietDelay, current.delay + activeDelay)
          : idleDelay;
      } catch (failure) {
        if (generation !== current.generation || !current.subscribers.size) return;
        const error = failure instanceof Error ? failure : new Error("Could not load Agent task");
        const fatal = error instanceof AgentStateProtocolError;
        for (const item of [...current.subscribers]) {
          const matches = item.jobId ? item.jobId === jobId : !jobId || current.latestJobId === jobId;
          if (current.subscribers.has(item) && matches) item.onError?.(error, fatal);
        }
        delay = Math.min(idleDelay * 6, activeDelay * 2 ** ++current.failures);
      } finally {
        clearTimeout(timeout);
        current.request = undefined;
        current.delay = delay;
        if (current.subscribers.size) schedule(hidden() ? Math.max(idleDelay * 3, delay * 3) : delay);
        else if (streams.get(sessionId) === current) streams.delete(sessionId);
      }
    };

    // A waiter arriving during idle observation wakes the existing stream, never starts another request.
    if (current.timer && subscriber.jobId) {
      clearTimeout(current.timer);
      current.timer = undefined;
    }
    schedule(subscriber.jobId || current.revision < 0 ? 0 : current.delay);
    return () => {
      current.subscribers.delete(subscriber);
      if (current.subscribers.size) return;
      current.generation++;
      if (current.timer) clearTimeout(current.timer);
      current.timer = undefined;
      current.request?.abort();
      if (!current.request && streams.get(sessionId) === current) streams.delete(sessionId);
    };
  }
  return { subscribe };
}

export const agentStateObserver = createAgentStateObserver();
