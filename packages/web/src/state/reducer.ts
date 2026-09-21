import { SITE_IDS, type ServerMsg, type SiteId, type SiteState, type SiteStatus } from "@katsu-magi/shared";

export interface Answer {
  text: string;
  status: SiteStatus;
  error?: string;
}

export interface Turn {
  requestId: string;
  prompt: string;
  sites: SiteId[];
  answers: Partial<Record<SiteId, Answer>>;
}

export interface AppState {
  connected: boolean;
  sites: Record<SiteId, SiteState>;
  browser: { running: boolean; visible: boolean };
  busyRequestId?: string;
  turns: Turn[];
  /** Transient, non-site-specific error (BUSY, BAD_MESSAGE, ...). */
  notice?: string;
}

export type Action =
  | { type: "connected"; connected: boolean }
  | { type: "server"; msg: ServerMsg }
  | { type: "localPrompt"; requestId: string; prompt: string; sites: SiteId[] }
  | { type: "clearTurns" }
  | { type: "dismissNotice" };

export const initialState: AppState = {
  connected: false,
  sites: Object.fromEntries(SITE_IDS.map((id) => [id, { enabled: true, status: "starting" }])) as Record<SiteId, SiteState>,
  browser: { running: false, visible: true },
  turns: [],
};

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "connected":
      return { ...state, connected: action.connected };

    case "localPrompt": {
      const turn: Turn = {
        requestId: action.requestId,
        prompt: action.prompt,
        sites: action.sites,
        answers: Object.fromEntries(action.sites.map((s) => [s, { text: "", status: "typing" as SiteStatus }])),
      };
      return { ...state, turns: [...state.turns, turn] };
    }

    case "clearTurns":
      return { ...state, turns: [] };

    case "dismissNotice": {
      const { notice: _n, ...rest } = state;
      return rest;
    }

    case "server":
      return applyServer(state, action.msg);
  }
}

function applyServer(state: AppState, msg: ServerMsg): AppState {
  switch (msg.type) {
    case "state": {
      const { busyRequestId, ...rest } = msg;
      const next: AppState = { ...state, sites: rest.sites, browser: rest.browser };
      if (busyRequestId) next.busyRequestId = busyRequestId;
      else delete next.busyRequestId;
      return next;
    }

    case "siteStatus": {
      const site: SiteState = { ...state.sites[msg.site], status: msg.status };
      if (msg.message !== undefined) site.message = msg.message;
      else delete site.message;
      const sites = { ...state.sites, [msg.site]: site };
      // Mirror the status into the current turn so each column shows per-turn progress.
      const turns = updateCurrentTurnAnswer(state, msg.site, (a) => ({ ...a, status: msg.status }));
      return { ...state, sites, turns };
    }

    case "answer": {
      const turns = state.turns.map((t) =>
        t.requestId !== msg.requestId
          ? t
          : {
              ...t,
              answers: {
                ...t.answers,
                [msg.site]: {
                  ...(t.answers[msg.site] ?? { status: "streaming" as SiteStatus }),
                  text: msg.text,
                  status: msg.done ? ("done" as SiteStatus) : ("streaming" as SiteStatus),
                },
              },
            },
      );
      return { ...state, turns };
    }

    case "error": {
      if (!msg.site) return { ...state, notice: `${msg.code}: ${msg.message}` };
      const turns = updateTurnAnswer(state, msg.requestId, msg.site, (a) => ({ ...a, error: msg.message }));
      return { ...state, turns };
    }
  }
}

function updateCurrentTurnAnswer(state: AppState, site: SiteId, fn: (a: Answer) => Answer): Turn[] {
  const current = state.busyRequestId ?? state.turns.at(-1)?.requestId;
  if (!current) return state.turns;
  return updateTurnAnswer(state, current, site, fn);
}

function updateTurnAnswer(state: AppState, requestId: string | undefined, site: SiteId, fn: (a: Answer) => Answer): Turn[] {
  if (!requestId) return state.turns;
  return state.turns.map((t) => {
    if (t.requestId !== requestId || !t.sites.includes(site)) return t;
    const prev = t.answers[site] ?? { text: "", status: "typing" as SiteStatus };
    return { ...t, answers: { ...t.answers, [site]: fn(prev) } };
  });
}
