// What the frontend imports.
//
//   import { IcarusVoice } from './voice/src/client';
//
// Types for the events and the assistant contract are exported too.

export { IcarusVoice } from './icarus-voice';
export type { IcarusVoiceOptions } from './icarus-voice';
export type {
  AskResponse,
  Assistant,
  AssistantReply,
  AssistantRequest,
  ConfirmIntentEvent,
  ConfirmPhase,
  CountdownEvent,
  FinalTranscript,
  Lang,
  LangSetting,
  LocalCommand,
  Mode,
  Snapshot,
  TradePreview,
  TurnMetrics,
  UiAction,
  UsageTotals,
  VoiceEvents,
  VoiceState,
} from '../shared/types';
