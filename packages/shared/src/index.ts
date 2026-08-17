export type Language = "en" | "ja";
export const SUPPORTED_LANGUAGES: Language[] = ["en", "ja"];
export const DEFAULT_LANGUAGE: Language = "en";

export function isLanguage(value: unknown): value is Language {
  return (
    typeof value === "string" &&
    (SUPPORTED_LANGUAGES as string[]).includes(value)
  );
}

export type UserPreferenceDto = {
  userId: string;
  language: Language;
  agentRuntime: "api" | "codex" | "claude";
  updatedAt: string;
};

export {
  CAMERA_OPTIONS,
  LIGHTING_OPTIONS,
  MOTION_OPTIONS,
  EMOTION_OPTIONS,
  TONE_OPTIONS,
  getLocalizedLabels,
} from "./i18n-labels";
export type { LocalizedLabels } from "./i18n-labels";

export {
  TEST_ADJUSTMENTS,
  TEST_ADJUSTMENT_IDS,
  MAX_ADJUSTMENTS_PER_VARIANT,
  isTestAdjustmentId,
} from "./adjustments";
export type { TestAdjustmentId, TestAdjustment } from "./adjustments";

export {
  BASE_NEGATIVE_PROMPT,
  RECOMMENDED_NEGATIVE_FENCE,
  composeNegativePrompt,
} from "./negative-prompt";

import type { TestAdjustmentId } from "./adjustments";

export type ApiHealthDto = {
  status: "ok";
  service: string;
};

export type ApiErrorDto = {
  error: {
    code: string;
    message: string;
  };
};

export type MeDto = {
  userId: string;
  organizationId: string;
  displayName: string;
  email: string | null;
};

export type AiRuntimeAvailabilityDto =
  | { status: "not_applicable" }
  | { status: "unchecked" }
  | {
      status: "available";
      version: string;
      authMethod: string;
      subscriptionLabel: string;
    }
  | { status: "unavailable"; reason: string; message: string };

export type AiRuntimeCapabilitiesDto = {
  supportsExplicitCompact: boolean;
  supportsMidTurnCancellationWithoutEndingSession: boolean;
  supportsApprovalRequests: boolean;
  sessionIdKnownBeforeStart: boolean;
};

// Why the embedded chat is or is not usable right now. Separate from the
// capability runtime above, because the two can be configured independently.
export type AiChatRuntimeDto = {
  runtime: "api" | "codex" | "claude";
  available: boolean;
  reason: string | null;
};

export type AiRuntimeInfoDto = {
  runtime: "api" | "codex" | "claude";
  wallet: "api_key" | "subscription";
  availability: AiRuntimeAvailabilityDto;
  capabilities: AiRuntimeCapabilitiesDto | null;
  chat: AiChatRuntimeDto;
};

export type ProjectDto = {
  id: string;
  organizationId: string;
  ownerUserId: string;
  name: string;
  status: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PhotoAssetDto = {
  id: string;
  projectId: string;
  name: string;
  usage: string;
  storageKey: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  checksum: string;
  sourceKind: string;
  notes: string | null;
  position: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScenePhotoAssetDto = {
  photoAssetId: string;
  role: string;
};

// The five ordered setup steps, plus "complete" when the data satisfies all of
// them. Derived server-side from one domain rule so the UI never re-implements
// the gate.
export type StoryboardSetupStepDto =
  | "photos"
  | "tone"
  | "style"
  | "story"
  | "scenes"
  | "complete";

export type StoryboardDto = {
  id: string;
  projectId: string;
  status: string;
  // Empty means the tone has not been decided yet.
  tone: string;
  stylePresetId: string | null;
  commonPrompt: string;
  story: string;
  negativePrompt: string;
  characterPolicy: "featured" | "background_only" | "none";
  sceneIds: string[];
  setupStep: StoryboardSetupStepDto;
  // Set once the storyboard has been through all five steps; from then on the
  // UI stops gating and every section is editable.
  setupCompletedAt: string | null;
  // Scenes still missing AI-fillable text, and therefore the number of AI calls
  // a bulk fill would spend. Server-derived so the UI can state the cost.
  pendingSceneFillCount: number;
  createdAt: string;
  updatedAt: string;
};

export type SceneBridgeDto = {
  fromSceneId: string;
  toSceneId: string;
};

export type SceneDto = {
  id: string;
  projectId: string;
  storyboardId: string;
  orderIndex: number;
  status: string;
  kind: string;
  bridge: SceneBridgeDto | null;
  title: string;
  description: string;
  imagePrompt: string;
  emotion: string;
  cameraDirection: string;
  lightingDirection: string;
  motionDirection: string;
  notes: string;
  negativePrompt: string;
  photoFidelity: "off" | "low" | "high";
  photoAssets: ScenePhotoAssetDto[];
  adoptedGeneratedImageId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ComplementSceneProposalDto = {
  title: string;
  description: string;
  imagePrompt: string;
  emotion: string;
  cameraDirection: string;
  lightingDirection: string;
  motionDirection: string;
};

export type StylePresetDto = {
  id: string;
  scope: string;
  name: string;
  description: string;
  prompt: string;
  previewImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GenerationRequestDto = {
  id: string;
  projectId: string;
  storyboardId: string;
  sceneId: string;
  status: string;
  inputJson: Record<string, unknown>;
  errorMessage: string | null;
  sourceGenerationRequestId: string | null;
  // Non-null on a test-generation sample. Scene-scoped history lists only ever
  // carry the confirmed sample, so a non-null value there marks that entry as
  // "the sample this scene's look was chosen from".
  testGenerationBatchId: string | null;
  appliedAdjustments: TestAdjustmentId[];
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiJobDto = {
  id: string;
  projectId: string;
  kind: string;
  status: string;
  inputJson: Record<string, unknown>;
  resultJson: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GenerationRequestWithSceneTitleDto = GenerationRequestDto & {
  sceneTitle: string | null;
};

export type GeneratedImageDto = {
  id: string;
  projectId: string;
  storyboardId: string;
  sceneId: string;
  generationRequestId: string;
  storageKey: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  checksum: string;
  adoptedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CharacterReferenceSheetDto = {
  jobId: string;
  storyboardId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  storageKey: string | null;
  mimeType: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TestGenerationBatchDto = {
  id: string;
  storyboardId: string;
  status: string;
  confirmedGenerationRequestId: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type TestGenerationBatchVariantDto = {
  request: GenerationRequestDto;
  generatedImage: GeneratedImageDto | null;
};

// One entry of a storyboard's sample history: the batch plus its samples in
// variant order, each with its image when the generation succeeded.
export type TestGenerationBatchWithVariantsDto = {
  batch: TestGenerationBatchDto;
  variants: TestGenerationBatchVariantDto[];
};

export type EmotionCandidateDto = {
  value: string;
  label: string;
  description: string;
  reason: string;
};

export type PhotoInsightDto = {
  photoAssetId: string;
  summary: string;
  people: string;
  setting: string;
  event: string;
  atmosphere: string;
};

export type ProjectPhotoAnalysisDto = {
  id: string;
  projectId: string;
  emotionCandidates: EmotionCandidateDto[];
  photoInsights: PhotoInsightDto[];
  storySummary: string;
  model: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// ── Change proposals (agent propose -> approve -> apply) ────────────────────

export type SemanticTargetDto = {
  entityType: "project" | "storyboard" | "scene";
  entityId: string;
  field:
    | "photoAnalysis"
    | "tone"
    | "stylePresetId"
    | "commonPrompt"
    | "story"
    | "negativePrompt"
    | "characterPolicy"
    | "scene";
};

// The current value of one addressable creative field plus the revision a
// proposal against it must be based on.
export type SemanticTargetSnapshotDto = {
  target: SemanticTargetDto;
  value: unknown;
  revision: string;
};

// The valid values for the `stylePresetId` field, so an agent proposing a
// style preset names a real one instead of inventing an ID.
export type CreativeDirectionStylePresetOptionDto = {
  id: string;
  name: string;
  description: string;
  scope: string;
};

export type CreativeDirectionDto = {
  projectId: string;
  projectName: string;
  storyboardId: string | null;
  stylePresetOptions: CreativeDirectionStylePresetOptionDto[];
  fields: SemanticTargetSnapshotDto[];
};

export type ChangeProposalItemDto = {
  id: string;
  target: SemanticTargetDto;
  before: unknown;
  after: unknown;
  rationale: string;
  baseRevision: string;
  approval: "pending" | "approved" | "rejected";
};

export type ChangeProposalChoiceOptionDto = {
  id: string;
  label: string;
  value: unknown;
  reason: string;
  impact: string;
};

export type ChangeProposalChoiceDto = {
  targetItemId: string;
  options: ChangeProposalChoiceOptionDto[];
  selectedOptionId: string | null;
};

export type ChangeProposalDto = {
  id: string;
  projectId: string;
  provider: "codex" | "claude";
  conversationId: string;
  turnId: string;
  rationale: string;
  status:
    | "pending"
    | "partially_approved"
    | "approved"
    | "rejected"
    | "applied"
    | "conflicted";
  items: ChangeProposalItemDto[];
  choices: ChangeProposalChoiceDto[];
  clientRequestId: string;
  approvedBy: string | null;
  resolvedAt: string | null;
  applyOutcome: {
    appliedItemIds: string[];
    appliedAt: string;
    appliedBy: string;
  } | null;
  createdAt: string;
  updatedAt: string;
};

// ── Embedded agent chat (M3) ───────────────────────────────────────────────

export type SemanticMentionDto = {
  label: string;
  target: SemanticTargetDto;
};

export type AgentConversationMessageDto = {
  id: string;
  conversationId: string;
  turnId: string | null;
  sequence: number;
  role: "user" | "assistant" | "system";
  kind:
    | "user_text"
    | "assistant_text"
    | "tool_activity"
    | "proposal"
    | "notice";
  text: string;
  mentions: SemanticMentionDto[];
  data: Record<string, unknown> | null;
  createdAt: string;
};

export type AgentConversationTurnDto = {
  id: string;
  conversationId: string;
  bindingId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  provider: "codex" | "claude";
  model: string | null;
  providerTurnId: string | null;
  compacted: boolean;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
};

// What the chat header shows: which provider-native session this conversation
// is continuing, and how its context has been managed.
export type AgentProviderBindingDto = {
  id: string;
  conversationId: string;
  provider: "codex" | "claude";
  model: string | null;
  nativeSessionId: string | null;
  status: "active" | "compacting" | "recoverable" | "closed";
  compactCount: number;
  lastCompactedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentConversationDto = {
  id: string;
  projectId: string;
  title: string;
  activeBindingId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentConversationDetailDto = {
  conversation: AgentConversationDto;
  binding: AgentProviderBindingDto | null;
  turns: AgentConversationTurnDto[];
  messages: AgentConversationMessageDto[];
};
