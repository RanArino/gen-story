"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import styles from "./MockFlowClient.module.css";

type ScreenId =
  | "projects"
  | "create"
  | "upload"
  | "manage"
  | "emotion"
  | "storyboard"
  | "compare";

type OccasionId =
  | "anniversary"
  | "wedding"
  | "birthday"
  | "graduation"
  | "travel"
  | "family"
  | "other";

type Project = {
  id: string;
  title: string;
  occasion: string;
  updatedAt: string;
  photoCount: number;
  progress: string;
};

type PhotoUsage = "use" | "reference" | "unused";

type MockPhoto = {
  id: string;
  name: string;
  source: "local" | "sample";
  previewUrl?: string;
  usage: PhotoUsage;
  memo: string;
  analysisTags: string[];
  recommendedRank: number;
};

type LocalPhoto = MockPhoto & {
  source: "local";
  previewUrl: string;
};

type ToneId = "warm" | "cinematic" | "playful" | "quiet";

type StyleId =
  | "ai-recommend"
  | "cinematic-live"
  | "anime-film"
  | "warm-drawn"
  | "transparent-light"
  | "film-photo"
  | "watercolor"
  | "mono-film"
  | "three-d";

type StoryboardView = "cards" | "timeline" | "gallery" | "table";

type Candidate = {
  id: string;
  label: string;
  detail: string;
  previewClass: string;
};

type Scene = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  primaryPhotoId: string;
  deliveredEmotion: string;
  camera: string;
  lighting: string;
  motion: string;
  notes: string;
  adoptedCandidateId: string;
  retryCount: number;
};

type DraftProject = {
  title: string;
  occasionId: OccasionId;
  customOccasion: string;
};

const cssClass = (value: string | undefined) => value ?? "";

const screens: Array<{ id: ScreenId; label: string }> = [
  { id: "projects", label: "Projects" },
  { id: "create", label: "Create" },
  { id: "upload", label: "Upload" },
  { id: "manage", label: "Analyze" },
  { id: "emotion", label: "Style" },
  { id: "storyboard", label: "Storyboard" },
  { id: "compare", label: "Review" },
];

const occasionOptions: Array<{
  id: OccasionId;
  label: string;
  description: string;
}> = [
  {
    id: "anniversary",
    label: "Anniversary",
    description: "A relationship or family milestone.",
  },
  {
    id: "wedding",
    label: "Wedding",
    description: "Ceremony, reception, or couple story.",
  },
  {
    id: "birthday",
    label: "Birthday",
    description: "A celebration focused on one person.",
  },
  {
    id: "graduation",
    label: "Graduation",
    description: "School, career, or achievement memory.",
  },
  {
    id: "travel",
    label: "Travel",
    description: "A trip, place, or shared journey.",
  },
  {
    id: "family",
    label: "Family memory",
    description: "Everyday moments and personal archive.",
  },
  {
    id: "other",
    label: "Other theme",
    description: "Use a custom label for another occasion.",
  },
];

const initialProjects: Project[] = [
  {
    id: "anniversary",
    title: "Anniversary Dinner",
    occasion: "Anniversary",
    updatedAt: "Today 09:42",
    photoCount: 18,
    progress: "Storyboard draft",
  },
  {
    id: "graduation",
    title: "Graduation Album",
    occasion: "Graduation",
    updatedAt: "Yesterday 16:10",
    photoCount: 24,
    progress: "Photo review",
  },
];

const samplePhotos: MockPhoto[] = [
  {
    id: "sample-portrait",
    name: "Portrait favorite",
    source: "sample",
    usage: "use",
    memo: "Strong expression for the opening memory.",
    analysisTags: ["smiling face", "warm light", "clear subject"],
    recommendedRank: 1,
  },
  {
    id: "sample-table",
    name: "Dinner table",
    source: "sample",
    usage: "reference",
    memo: "Useful setting details for color and props.",
    analysisTags: ["table setting", "ambient light", "family context"],
    recommendedRank: 3,
  },
  {
    id: "sample-toast",
    name: "Toast moment",
    source: "sample",
    usage: "use",
    memo: "Good mid-story celebration beat.",
    analysisTags: ["gesture", "group reaction", "celebration"],
    recommendedRank: 2,
  },
];

const toneOptions: Array<{
  id: ToneId;
  label: string;
  description: string;
  previewClass: string;
}> = [
  {
    id: "warm",
    label: "Warm",
    description: "Soft family story with gentle color and steady pacing.",
    previewClass: cssClass(styles.previewWarm),
  },
  {
    id: "cinematic",
    label: "Cinematic",
    description: "Dramatic framing, deeper contrast, and film-like beats.",
    previewClass: cssClass(styles.previewCinematic),
  },
  {
    id: "playful",
    label: "Playful",
    description: "Bright expressions, lively transitions, and upbeat scenes.",
    previewClass: cssClass(styles.previewPlayful),
  },
  {
    id: "quiet",
    label: "Quiet",
    description: "Minimal composition, subtle emotion, and calm narration.",
    previewClass: cssClass(styles.previewQuiet),
  },
];

const styleOptions: Array<{
  id: StyleId;
  label: string;
  description: string;
  previewClass: string;
}> = [
  {
    id: "ai-recommend",
    label: "AI recommendation",
    description: "Balanced style chosen from photo mood and occasion.",
    previewClass: cssClass(styles.styleRecommend),
  },
  {
    id: "cinematic-live",
    label: "Cinematic live-action",
    description: "Realistic lighting with film still composition.",
    previewClass: cssClass(styles.styleCinematic),
  },
  {
    id: "anime-film",
    label: "Anime film",
    description: "Illustrated film frame with clear emotion.",
    previewClass: cssClass(styles.styleAnime),
  },
  {
    id: "warm-drawn",
    label: "Warm hand-drawn",
    description: "Soft personal illustration with handmade texture.",
    previewClass: cssClass(styles.styleDrawn),
  },
  {
    id: "transparent-light",
    label: "Transparent light",
    description: "Airy, clean, bright, and low contrast.",
    previewClass: cssClass(styles.styleTransparent),
  },
  {
    id: "film-photo",
    label: "Film photo",
    description: "Photographic grain and natural color response.",
    previewClass: cssClass(styles.styleFilm),
  },
  {
    id: "watercolor",
    label: "Watercolor",
    description: "Painted edges and gentle paper texture.",
    previewClass: cssClass(styles.styleWatercolor),
  },
  {
    id: "mono-film",
    label: "Monochrome film",
    description: "Black-and-white keepsake with strong contrast.",
    previewClass: cssClass(styles.styleMono),
  },
  {
    id: "three-d",
    label: "3D animation",
    description: "Polished character-like shapes and bright depth.",
    previewClass: cssClass(styles.style3d),
  },
];

const candidates: Candidate[] = [
  {
    id: "soft-light",
    label: "Soft light",
    detail: "Pastel background with close portrait framing.",
    previewClass: cssClass(styles.swatchSoft),
  },
  {
    id: "editorial",
    label: "Editorial",
    detail: "Magazine crop with strong foreground subject.",
    previewClass: cssClass(styles.swatchEditorial),
  },
  {
    id: "memory",
    label: "Memory",
    detail: "Layered keepsake treatment with a warm vignette.",
    previewClass: cssClass(styles.swatchMemory),
  },
];

const sceneEmotionOptions = [
  "Warm relief",
  "Joyful surprise",
  "Quiet gratitude",
  "Nostalgic calm",
];

const cameraOptions = [
  "Close portrait",
  "Medium group frame",
  "Wide establishing frame",
  "Over-the-shoulder",
];

const lightingOptions = [
  "Warm indoor glow",
  "Soft daylight",
  "High contrast film",
  "Transparent bright tone",
];

const motionOptions = [
  "Still keepsake",
  "Gentle push-in",
  "Left-to-right reveal",
  "Slow timeline beat",
];

const defaultScenes: Scene[] = [
  {
    id: "scene-open",
    title: "Opening memory",
    description: "Introduce the main person and the feeling of the occasion.",
    prompt:
      "Begin with the guest of honor arriving at the table, surrounded by familiar faces and warm light.",
    primaryPhotoId: "sample-portrait",
    deliveredEmotion: "Warm relief",
    camera: "Close portrait",
    lighting: "Warm indoor glow",
    motion: "Gentle push-in",
    notes: "Keep the face recognizable and avoid changing age.",
    adoptedCandidateId: "soft-light",
    retryCount: 0,
  },
  {
    id: "scene-middle",
    title: "Shared celebration",
    description: "Show the group reaction and the core celebration moment.",
    prompt:
      "Show the central celebration moment with expressive reactions and small personal details in the setting.",
    primaryPhotoId: "sample-toast",
    deliveredEmotion: "Joyful surprise",
    camera: "Medium group frame",
    lighting: "Soft daylight",
    motion: "Left-to-right reveal",
    notes: "Use table details only as reference context.",
    adoptedCandidateId: "editorial",
    retryCount: 0,
  },
  {
    id: "scene-close",
    title: "Closing keepsake",
    description: "End with a quieter image that feels complete and shareable.",
    prompt:
      "End on a quiet keepsake image that feels complete, personal, and ready to share with family.",
    primaryPhotoId: "sample-table",
    deliveredEmotion: "Nostalgic calm",
    camera: "Wide establishing frame",
    lighting: "Warm indoor glow",
    motion: "Still keepsake",
    notes: "Favor memory texture over literal table accuracy.",
    adoptedCandidateId: "memory",
    retryCount: 0,
  },
];

const createScene = (index: number, primaryPhotoId = ""): Scene => ({
  id: `scene-${Date.now()}-${index}`,
  title: `AI bridge scene ${index}`,
  description: "A suggested scene inserted between existing story beats.",
  prompt: "Describe the important story beat for this generated image.",
  primaryPhotoId,
  deliveredEmotion: "Quiet gratitude",
  camera: "Medium group frame",
  lighting: "Soft daylight",
  motion: "Gentle push-in",
  notes: "Mock AI completion scene; edit before generation.",
  adoptedCandidateId: "soft-light",
  retryCount: 0,
});

const isLocalPhoto = (photo: MockPhoto): photo is LocalPhoto =>
  photo.source === "local" && typeof photo.previewUrl === "string";

const getOccasionLabel = (draftProject: DraftProject) => {
  if (draftProject.occasionId === "other") {
    return draftProject.customOccasion.trim() || "Custom theme";
  }

  return (
    occasionOptions.find((option) => option.id === draftProject.occasionId)
      ?.label ?? "Personal story"
  );
};

const assignPhotosToScenes = (scenes: Scene[], photos: MockPhoto[]) => {
  const usablePhotos = photos.filter((photo) => photo.usage !== "unused");
  if (usablePhotos.length === 0) {
    return scenes;
  }

  return scenes.map((scene, index) =>
    scene.primaryPhotoId === ""
      ? {
          ...scene,
          primaryPhotoId: usablePhotos[index % usablePhotos.length]?.id ?? "",
        }
      : scene,
  );
};

export function MockFlowClient() {
  const [screen, setScreen] = useState<ScreenId>("projects");
  const [history, setHistory] = useState<ScreenId[]>([]);
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [currentProjectId, setCurrentProjectId] = useState(
    initialProjects[0]?.id ?? "",
  );
  const [draftProject, setDraftProject] = useState<DraftProject>({
    title: "Family Story Set",
    occasionId: "anniversary",
    customOccasion: "",
  });
  const [photos, setPhotos] = useState<MockPhoto[]>(samplePhotos);
  const [aiOrderEnabled, setAiOrderEnabled] = useState(true);
  const [tone, setTone] = useState<ToneId>("warm");
  const [style, setStyle] = useState<StyleId>("ai-recommend");
  const [storyboardView, setStoryboardView] = useState<StoryboardView>("cards");
  const [scenes, setScenes] = useState<Scene[]>(defaultScenes);
  const photosRef = useRef<MockPhoto[]>(photos);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    return () => {
      photosRef.current.forEach((photo) => {
        if (isLocalPhoto(photo)) {
          URL.revokeObjectURL(photo.previewUrl);
        }
      });
    };
  }, []);

  const currentProject = useMemo(
    () => projects.find((project) => project.id === currentProjectId),
    [currentProjectId, projects],
  );

  const currentScreenIndex = Math.max(
    0,
    screens.findIndex((item) => item.id === screen),
  );

  const usablePhotos = photos.filter((photo) => photo.usage !== "unused");
  const adoptedCount = scenes.filter(
    (scene) => scene.adoptedCandidateId !== "",
  ).length;
  const selectedTone = toneOptions.find((option) => option.id === tone);
  const selectedStyle = styleOptions.find((option) => option.id === style);
  const canAdvanceFromUpload = photos.length > 0;

  const navigateTo = (nextScreen: ScreenId) => {
    if (nextScreen === screen) {
      return;
    }

    setHistory((previous) => [...previous, screen].slice(-16));
    setScreen(nextScreen);
  };

  const navigateNext = () => {
    const nextScreen = screens[currentScreenIndex + 1];
    if (nextScreen !== undefined) {
      navigateTo(nextScreen.id);
    }
  };

  const navigateBack = () => {
    if (history.length > 0) {
      const previousScreen = history[history.length - 1];
      if (previousScreen !== undefined) {
        setHistory((previous) => previous.slice(0, -1));
        setScreen(previousScreen);
        return;
      }
    }

    const previousScreen = screens[currentScreenIndex - 1];
    if (previousScreen !== undefined) {
      setScreen(previousScreen.id);
    }
  };

  const selectProject = (projectId: string) => {
    setCurrentProjectId(projectId);
    setPhotos(samplePhotos);
    setScenes(defaultScenes);
    setTone("warm");
    setStyle("ai-recommend");
    setAiOrderEnabled(true);
    navigateTo("upload");
  };

  const createProject = () => {
    const nextProject: Project = {
      id: `project-${Date.now()}`,
      title: draftProject.title.trim() || "Untitled story",
      occasion: getOccasionLabel(draftProject),
      updatedAt: "Just now",
      photoCount: 0,
      progress: "Photo upload",
    };

    setProjects((previous) => [nextProject, ...previous]);
    setCurrentProjectId(nextProject.id);
    setPhotos([]);
    setScenes(defaultScenes.map((scene) => ({ ...scene, primaryPhotoId: "" })));
    setTone("warm");
    setStyle("ai-recommend");
    setAiOrderEnabled(false);
    navigateTo("upload");
  };

  const handlePhotoSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.currentTarget.files ?? []).filter(
      (file) => file.type.startsWith("image/"),
    );

    if (selectedFiles.length === 0) {
      event.currentTarget.value = "";
      return;
    }

    const nextPhotos = selectedFiles.map((file, index): MockPhoto => {
      const nextRank = photos.length + index + 1;
      return {
        id: `local-${Date.now()}-${index}-${file.name}`,
        name: file.name,
        source: "local",
        previewUrl: URL.createObjectURL(file),
        usage: index === 0 ? "use" : "reference",
        memo: "",
        analysisTags:
          index === 0
            ? ["clear subject", "usable expression", "high priority"]
            : ["supporting detail", "reference context", "needs review"],
        recommendedRank: nextRank,
      };
    });

    setPhotos((previous) => [...previous, ...nextPhotos]);
    setScenes((previous) =>
      assignPhotosToScenes(previous, [...photos, ...nextPhotos]),
    );
    setProjects((previous) =>
      previous.map((project) =>
        project.id === currentProjectId
          ? {
              ...project,
              photoCount: project.photoCount + nextPhotos.length,
              progress: "AI photo review",
            }
          : project,
      ),
    );
    event.currentTarget.value = "";
  };

  const addSamplePhotos = () => {
    const existingSampleIds = new Set(photos.map((photo) => photo.id));
    const missingSamples = samplePhotos.filter(
      (photo) => !existingSampleIds.has(photo.id),
    );

    if (missingSamples.length === 0) {
      return;
    }

    const nextPhotos = [...photos, ...missingSamples];
    setPhotos(nextPhotos);
    setScenes((previous) => assignPhotosToScenes(previous, nextPhotos));
  };

  const removePhoto = (photoId: string) => {
    setPhotos((previous) => {
      const photo = previous.find((item) => item.id === photoId);
      if (photo !== undefined && isLocalPhoto(photo)) {
        URL.revokeObjectURL(photo.previewUrl);
      }

      return previous.filter((item) => item.id !== photoId);
    });
    setScenes((previous) =>
      previous.map((scene) =>
        scene.primaryPhotoId === photoId
          ? { ...scene, primaryPhotoId: "" }
          : scene,
      ),
    );
  };

  const updatePhoto = (photoId: string, updates: Partial<MockPhoto>) => {
    setPhotos((previous) =>
      previous.map((photo) =>
        photo.id === photoId ? { ...photo, ...updates } : photo,
      ),
    );
  };

  const movePhoto = (photoId: string, direction: "up" | "down") => {
    setPhotos((previous) => {
      const index = previous.findIndex((photo) => photo.id === photoId);
      if (index < 0) {
        return previous;
      }

      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= previous.length) {
        return previous;
      }

      const nextPhotos = [...previous];
      const currentPhoto = nextPhotos[index];
      const targetPhoto = nextPhotos[nextIndex];
      if (currentPhoto === undefined || targetPhoto === undefined) {
        return previous;
      }

      nextPhotos[index] = targetPhoto;
      nextPhotos[nextIndex] = currentPhoto;
      return nextPhotos;
    });
    setAiOrderEnabled(false);
  };

  const updateScene = (sceneId: string, updates: Partial<Scene>) => {
    setScenes((previous) =>
      previous.map((scene) =>
        scene.id === sceneId ? { ...scene, ...updates } : scene,
      ),
    );
  };

  const moveScene = (sceneId: string, direction: "up" | "down") => {
    setScenes((previous) => {
      const index = previous.findIndex((scene) => scene.id === sceneId);
      if (index < 0) {
        return previous;
      }

      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= previous.length) {
        return previous;
      }

      const nextScenes = [...previous];
      const currentScene = nextScenes[index];
      const targetScene = nextScenes[nextIndex];
      if (currentScene === undefined || targetScene === undefined) {
        return previous;
      }

      nextScenes[index] = targetScene;
      nextScenes[nextIndex] = currentScene;
      return nextScenes;
    });
  };

  const addScene = () => {
    setScenes((previous) => [
      ...previous,
      createScene(previous.length + 1, usablePhotos[0]?.id ?? ""),
    ]);
  };

  const insertSceneAfter = (sceneId: string) => {
    setScenes((previous) => {
      const index = previous.findIndex((scene) => scene.id === sceneId);
      if (index < 0) {
        return previous;
      }

      const nextScenes = [...previous];
      nextScenes.splice(
        index + 1,
        0,
        createScene(
          index + 2,
          usablePhotos[(index + 1) % usablePhotos.length]?.id ?? "",
        ),
      );
      return nextScenes;
    });
  };

  const removeScene = (sceneId: string) => {
    setScenes((previous) => {
      if (previous.length <= 1) {
        return previous;
      }

      return previous.filter((scene) => scene.id !== sceneId);
    });
  };

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Mock flow navigation">
        <div>
          <p className={styles.eyebrow}>Gen Story</p>
          <h1 className={styles.appTitle}>Clickable UI Mock</h1>
        </div>
        <nav className={styles.stepList}>
          {screens.map((item, index) => {
            const isActive = item.id === screen;
            return (
              <button
                className={`${styles.stepButton} ${
                  isActive ? styles.stepButtonActive : ""
                }`}
                key={item.id}
                onClick={() => navigateTo(item.id)}
                type="button"
              >
                <span className={styles.stepNumber}>{index + 1}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.topbar}>
          <div>
            <p className={styles.eyebrow}>Current project</p>
            <h2 className={styles.projectTitle}>
              {currentProject?.title ?? "No project selected"}
            </h2>
          </div>
          <div className={styles.summaryGrid} aria-label="Mock state summary">
            <SummaryMetric label="Photos" value={String(photos.length)} />
            <SummaryMetric label="Tone" value={selectedTone?.label ?? "None"} />
            <SummaryMetric
              label="Style"
              value={selectedStyle?.label ?? "None"}
            />
            <SummaryMetric
              label="Adopted"
              value={`${adoptedCount}/${scenes.length}`}
            />
          </div>
        </header>

        <div className={styles.content}>
          {screen === "projects" && (
            <ProjectListScreen
              currentProjectId={currentProjectId}
              onCreate={() => navigateTo("create")}
              onSelect={selectProject}
              projects={projects}
            />
          )}
          {screen === "create" && (
            <ProjectCreationScreen
              draftProject={draftProject}
              onBack={navigateBack}
              onCreate={createProject}
              onDraftChange={setDraftProject}
            />
          )}
          {screen === "upload" && (
            <PhotoUploadScreen
              canAdvance={canAdvanceFromUpload}
              onAddSamples={addSamplePhotos}
              onBack={navigateBack}
              onContinue={navigateNext}
              onPhotoSelection={handlePhotoSelection}
              onRemovePhoto={removePhoto}
              photos={photos}
            />
          )}
          {screen === "manage" && (
            <PhotoAnalysisScreen
              aiOrderEnabled={aiOrderEnabled}
              onBack={navigateBack}
              onContinue={navigateNext}
              onMovePhoto={movePhoto}
              onRemovePhoto={removePhoto}
              onToggleAiOrder={() => setAiOrderEnabled((previous) => !previous)}
              onUpdatePhoto={updatePhoto}
              photos={photos}
            />
          )}
          {screen === "emotion" && (
            <EmotionStyleScreen
              onBack={navigateBack}
              onContinue={navigateNext}
              onStyleChange={setStyle}
              onToneChange={setTone}
              style={style}
              tone={tone}
            />
          )}
          {screen === "storyboard" && (
            <StoryboardEditorScreen
              onAddScene={addScene}
              onBack={navigateBack}
              onContinue={navigateNext}
              onInsertSceneAfter={insertSceneAfter}
              onMoveScene={moveScene}
              onRemoveScene={removeScene}
              onUpdateScene={updateScene}
              onViewChange={setStoryboardView}
              photos={usablePhotos}
              scenes={scenes}
              view={storyboardView}
            />
          )}
          {screen === "compare" && (
            <GeneratedReviewScreen
              onBack={navigateBack}
              onUpdateScene={updateScene}
              photos={usablePhotos}
              scenes={scenes}
              styleLabel={selectedStyle?.label ?? "None"}
              toneLabel={selectedTone?.label ?? "None"}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProjectListScreen({
  currentProjectId,
  onCreate,
  onSelect,
  projects,
}: {
  currentProjectId: string;
  onCreate: () => void;
  onSelect: (projectId: string) => void;
  projects: Project[];
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.screenHeader}>
        <div>
          <p className={styles.eyebrow}>Project list</p>
          <h2>Choose a story workspace</h2>
        </div>
        <button
          className={styles.primaryButton}
          onClick={onCreate}
          type="button"
        >
          New project
        </button>
      </div>

      <div className={styles.projectGrid}>
        {projects.map((project) => (
          <article className={styles.projectCard} key={project.id}>
            <div>
              <p className={styles.projectMeta}>{project.occasion}</p>
              <h3>{project.title}</h3>
            </div>
            <dl className={styles.cardStats}>
              <div>
                <dt>Photos</dt>
                <dd>{project.photoCount}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{project.progress}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{project.updatedAt}</dd>
              </div>
            </dl>
            <button
              className={
                project.id === currentProjectId
                  ? styles.secondaryButtonActive
                  : styles.secondaryButton
              }
              onClick={() => onSelect(project.id)}
              type="button"
            >
              {project.id === currentProjectId ? "Continue project" : "Open"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProjectCreationScreen({
  draftProject,
  onBack,
  onCreate,
  onDraftChange,
}: {
  draftProject: DraftProject;
  onBack: () => void;
  onCreate: () => void;
  onDraftChange: (draft: DraftProject) => void;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.screenHeader}>
        <div>
          <p className={styles.eyebrow}>Project creation</p>
          <h2>Start a new story set</h2>
        </div>
      </div>

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Project title</span>
          <input
            onChange={(event) =>
              onDraftChange({ ...draftProject, title: event.target.value })
            }
            value={draftProject.title}
          />
        </label>
      </div>

      <div>
        <p className={styles.fieldLabel}>Occasion or theme</p>
        <div className={styles.optionGrid}>
          {occasionOptions.map((option) => (
            <button
              className={`${styles.optionCard} ${
                option.id === draftProject.occasionId
                  ? styles.optionCardActive
                  : ""
              }`}
              key={option.id}
              onClick={() =>
                onDraftChange({ ...draftProject, occasionId: option.id })
              }
              type="button"
            >
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </div>
      </div>

      {draftProject.occasionId === "other" && (
        <label className={styles.field}>
          <span>Custom occasion label</span>
          <input
            onChange={(event) =>
              onDraftChange({
                ...draftProject,
                customOccasion: event.target.value,
              })
            }
            value={draftProject.customOccasion}
          />
        </label>
      )}

      <div className={styles.actionRow}>
        <button
          className={styles.secondaryButton}
          onClick={onBack}
          type="button"
        >
          Back
        </button>
        <button
          className={styles.primaryButton}
          onClick={onCreate}
          type="button"
        >
          Create and upload photos
        </button>
      </div>
    </section>
  );
}

function PhotoUploadScreen({
  canAdvance,
  onAddSamples,
  onBack,
  onContinue,
  onPhotoSelection,
  onRemovePhoto,
  photos,
}: {
  canAdvance: boolean;
  onAddSamples: () => void;
  onBack: () => void;
  onContinue: () => void;
  onPhotoSelection: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemovePhoto: (photoId: string) => void;
  photos: MockPhoto[];
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.screenHeader}>
        <div>
          <p className={styles.eyebrow}>Photo upload</p>
          <h2>Select local images for browser preview</h2>
        </div>
      </div>

      <div className={styles.uploadArea}>
        <label className={styles.fileDrop}>
          <span className={styles.fileDropTitle}>Choose image files</span>
          <span className={styles.fileDropText}>
            Local previews stay in the browser and are not uploaded.
          </span>
          <input
            accept="image/*"
            multiple
            onChange={onPhotoSelection}
            type="file"
          />
        </label>
        <button
          className={styles.secondaryButton}
          onClick={onAddSamples}
          type="button"
        >
          Add sample set
        </button>
      </div>

      <PhotoGrid onRemovePhoto={onRemovePhoto} photos={photos} />

      <div className={styles.actionRow}>
        <button
          className={styles.secondaryButton}
          onClick={onBack}
          type="button"
        >
          Back
        </button>
        <button
          className={styles.primaryButton}
          disabled={!canAdvance}
          onClick={onContinue}
          type="button"
        >
          Review AI photo analysis
        </button>
      </div>
    </section>
  );
}

function PhotoAnalysisScreen({
  aiOrderEnabled,
  onBack,
  onContinue,
  onMovePhoto,
  onRemovePhoto,
  onToggleAiOrder,
  onUpdatePhoto,
  photos,
}: {
  aiOrderEnabled: boolean;
  onBack: () => void;
  onContinue: () => void;
  onMovePhoto: (photoId: string, direction: "up" | "down") => void;
  onRemovePhoto: (photoId: string) => void;
  onToggleAiOrder: () => void;
  onUpdatePhoto: (photoId: string, updates: Partial<MockPhoto>) => void;
  photos: MockPhoto[];
}) {
  const visiblePhotos = aiOrderEnabled
    ? [...photos].sort(
        (first, second) => first.recommendedRank - second.recommendedRank,
      )
    : photos;

  return (
    <section className={styles.panel}>
      <div className={styles.screenHeader}>
        <div>
          <p className={styles.eyebrow}>Mock AI photo analysis</p>
          <h2>Curate photos before tone and style selection</h2>
        </div>
        <button
          className={
            aiOrderEnabled
              ? styles.secondaryButtonActive
              : styles.secondaryButton
          }
          onClick={onToggleAiOrder}
          type="button"
        >
          AI recommended order {aiOrderEnabled ? "on" : "off"}
        </button>
      </div>

      <div className={styles.analysisList}>
        {visiblePhotos.map((photo, index) => (
          <article className={styles.analysisRow} key={photo.id}>
            <div className={styles.rankBadge}>
              {aiOrderEnabled ? photo.recommendedRank : index + 1}
            </div>
            <PhotoPreview photo={photo} />
            <div className={styles.analysisDetails}>
              <div>
                <strong>{photo.name}</strong>
                <span>
                  {photo.source === "local" ? "Local preview" : "Sample mock"}
                </span>
              </div>
              <div className={styles.tagList}>
                {photo.analysisTags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <label className={styles.field}>
                <span>Reviewer memo</span>
                <input
                  onChange={(event) =>
                    onUpdatePhoto(photo.id, { memo: event.target.value })
                  }
                  value={photo.memo}
                />
              </label>
            </div>
            <div className={styles.analysisControls}>
              <label className={styles.field}>
                <span>Usage</span>
                <select
                  aria-label={`Usage for ${photo.name}`}
                  onChange={(event) =>
                    onUpdatePhoto(photo.id, {
                      usage: event.target.value as PhotoUsage,
                    })
                  }
                  value={photo.usage}
                >
                  <option value="use">Use</option>
                  <option value="reference">Reference only</option>
                  <option value="unused">Do not use</option>
                </select>
              </label>
              <div className={styles.inlineButtons}>
                <button
                  className={styles.iconButton}
                  disabled={aiOrderEnabled || index === 0}
                  onClick={() => onMovePhoto(photo.id, "up")}
                  title="Move photo up"
                  type="button"
                >
                  Up
                </button>
                <button
                  className={styles.iconButton}
                  disabled={
                    aiOrderEnabled || index === visiblePhotos.length - 1
                  }
                  onClick={() => onMovePhoto(photo.id, "down")}
                  title="Move photo down"
                  type="button"
                >
                  Down
                </button>
              </div>
              <button
                className={styles.textButton}
                onClick={() => onRemovePhoto(photo.id)}
                type="button"
              >
                Remove
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className={styles.validationLine}>
        Mock AI labels are static. The curation state remains browser-only.
      </div>

      <div className={styles.actionRow}>
        <button
          className={styles.secondaryButton}
          onClick={onBack}
          type="button"
        >
          Back
        </button>
        <button
          className={styles.primaryButton}
          onClick={onContinue}
          type="button"
        >
          Choose emotion and style
        </button>
      </div>
    </section>
  );
}

function EmotionStyleScreen({
  onBack,
  onContinue,
  onStyleChange,
  onToneChange,
  style,
  tone,
}: {
  onBack: () => void;
  onContinue: () => void;
  onStyleChange: (style: StyleId) => void;
  onToneChange: (tone: ToneId) => void;
  style: StyleId;
  tone: ToneId;
}) {
  const selectedStyle = styleOptions.find((option) => option.id === style);

  return (
    <section className={styles.panel}>
      <div className={styles.screenHeader}>
        <div>
          <p className={styles.eyebrow}>Emotion and image style</p>
          <h2>Preview the project-wide generation direction</h2>
        </div>
      </div>

      <section className={styles.subsection}>
        <div>
          <p className={styles.fieldLabel}>AI emotion candidates</p>
          <div className={styles.toneGrid}>
            {toneOptions.map((option) => (
              <button
                className={`${styles.toneCard} ${
                  option.id === tone ? styles.toneCardActive : ""
                }`}
                key={option.id}
                onClick={() => onToneChange(option.id)}
                type="button"
              >
                <span
                  className={`${styles.previewPanel} ${option.previewClass}`}
                />
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.subsection}>
        <div className={styles.sectionHeadingRow}>
          <div>
            <p className={styles.fieldLabel}>Project-wide image style</p>
            <p className={styles.helperText}>
              The selected style applies to every storyboard scene.
            </p>
          </div>
          <div className={styles.modelBadge}>Model: gpt-image-2</div>
        </div>
        <div className={styles.styleGrid}>
          {styleOptions.map((option) => (
            <button
              className={`${styles.styleCard} ${
                option.id === style ? styles.styleCardActive : ""
              }`}
              key={option.id}
              onClick={() => onStyleChange(option.id)}
              type="button"
            >
              <span
                className={`${styles.previewPanel} ${option.previewClass}`}
              />
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.subsection}>
        <div className={styles.sectionHeadingRow}>
          <div>
            <p className={styles.fieldLabel}>Test generation preview</p>
            <p className={styles.helperText}>
              Three static patterns show where future test generations will be
              compared.
            </p>
          </div>
          <div className={styles.modelBadge}>Preset: Standard</div>
        </div>
        <div className={styles.candidateGrid}>
          {candidates.map((candidate) => (
            <article className={styles.previewCandidate} key={candidate.id}>
              <span
                className={`${styles.candidatePreview} ${candidate.previewClass}`}
              />
              <strong>{candidate.label}</strong>
              <span>{selectedStyle?.label ?? "Selected style"}</span>
            </article>
          ))}
        </div>
      </section>

      <div className={styles.actionRow}>
        <button
          className={styles.secondaryButton}
          onClick={onBack}
          type="button"
        >
          Back
        </button>
        <button
          className={styles.primaryButton}
          onClick={onContinue}
          type="button"
        >
          Edit storyboard
        </button>
      </div>
    </section>
  );
}

function StoryboardEditorScreen({
  onAddScene,
  onBack,
  onContinue,
  onInsertSceneAfter,
  onMoveScene,
  onRemoveScene,
  onUpdateScene,
  onViewChange,
  photos,
  scenes,
  view,
}: {
  onAddScene: () => void;
  onBack: () => void;
  onContinue: () => void;
  onInsertSceneAfter: (sceneId: string) => void;
  onMoveScene: (sceneId: string, direction: "up" | "down") => void;
  onRemoveScene: (sceneId: string) => void;
  onUpdateScene: (sceneId: string, updates: Partial<Scene>) => void;
  onViewChange: (view: StoryboardView) => void;
  photos: MockPhoto[];
  scenes: Scene[];
  view: StoryboardView;
}) {
  const photoById = useMemo(
    () => new Map(photos.map((photo) => [photo.id, photo])),
    [photos],
  );

  return (
    <section className={styles.panel}>
      <div className={styles.screenHeader}>
        <div>
          <p className={styles.eyebrow}>Storyboard editing</p>
          <h2>Shape scenes with source previews and generation notes</h2>
        </div>
        <button
          className={styles.secondaryButton}
          onClick={onAddScene}
          type="button"
        >
          Add scene
        </button>
      </div>

      <div className={styles.viewTabs} aria-label="Storyboard views">
        {[
          ["cards", "Cards"],
          ["timeline", "Timeline"],
          ["gallery", "Image gallery"],
          ["table", "Table"],
        ].map(([viewId, label]) => (
          <button
            className={
              view === viewId
                ? styles.secondaryButtonActive
                : styles.secondaryButton
            }
            key={viewId}
            onClick={() => onViewChange(viewId as StoryboardView)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {view === "cards" && (
        <div className={styles.sceneList}>
          {scenes.map((scene, index) => (
            <SceneCard
              index={index}
              key={scene.id}
              onInsertSceneAfter={onInsertSceneAfter}
              onMoveScene={onMoveScene}
              onRemoveScene={onRemoveScene}
              onUpdateScene={onUpdateScene}
              photo={photoById.get(scene.primaryPhotoId)}
              photos={photos}
              scene={scene}
              sceneCount={scenes.length}
            />
          ))}
        </div>
      )}

      {view === "timeline" && (
        <div className={styles.timelineList}>
          {scenes.map((scene, index) => (
            <article className={styles.timelineRow} key={scene.id}>
              <span className={styles.sceneNumber}>{index + 1}</span>
              <SourcePreview photo={photoById.get(scene.primaryPhotoId)} />
              <div>
                <strong>{scene.title}</strong>
                <p>{scene.description}</p>
                <div className={styles.tagList}>
                  <span>{scene.deliveredEmotion}</span>
                  <span>{scene.camera}</span>
                  <span>{scene.motion}</span>
                </div>
              </div>
              <button
                className={styles.textButton}
                onClick={() => onInsertSceneAfter(scene.id)}
                type="button"
              >
                Insert AI scene
              </button>
            </article>
          ))}
        </div>
      )}

      {view === "gallery" && (
        <div className={styles.storyGallery}>
          {scenes.map((scene, index) => (
            <article className={styles.galleryScene} key={scene.id}>
              <SourcePreview photo={photoById.get(scene.primaryPhotoId)} />
              <div>
                <span>Scene {index + 1}</span>
                <strong>{scene.title}</strong>
              </div>
            </article>
          ))}
        </div>
      )}

      {view === "table" && (
        <div className={styles.tableWrap}>
          <table className={styles.storyTable}>
            <thead>
              <tr>
                <th>Scene</th>
                <th>Source</th>
                <th>Description</th>
                <th>Emotion</th>
                <th>Camera</th>
                <th>Lighting</th>
                <th>Motion</th>
              </tr>
            </thead>
            <tbody>
              {scenes.map((scene, index) => (
                <tr key={scene.id}>
                  <td>
                    <input
                      aria-label={`Scene ${index + 1} title`}
                      onChange={(event) =>
                        onUpdateScene(scene.id, { title: event.target.value })
                      }
                      value={scene.title}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`Primary photo for ${scene.title}`}
                      onChange={(event) =>
                        onUpdateScene(scene.id, {
                          primaryPhotoId: event.target.value,
                        })
                      }
                      value={scene.primaryPhotoId}
                    >
                      <option value="">None</option>
                      {photos.map((photo) => (
                        <option key={photo.id} value={photo.id}>
                          {photo.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`Description for ${scene.title}`}
                      onChange={(event) =>
                        onUpdateScene(scene.id, {
                          description: event.target.value,
                        })
                      }
                      value={scene.description}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`Emotion for ${scene.title}`}
                      onChange={(event) =>
                        onUpdateScene(scene.id, {
                          deliveredEmotion: event.target.value,
                        })
                      }
                      value={scene.deliveredEmotion}
                    >
                      {sceneEmotionOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{scene.camera}</td>
                  <td>{scene.lighting}</td>
                  <td>{scene.motion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.validationLine}>
        {scenes.length > 0
          ? `${scenes.length} scene${scenes.length === 1 ? "" : "s"} ready for generated review.`
          : "Add at least one scene to continue."}
      </div>

      <div className={styles.actionRow}>
        <button
          className={styles.secondaryButton}
          onClick={onBack}
          type="button"
        >
          Back
        </button>
        <button
          className={styles.primaryButton}
          disabled={scenes.length === 0}
          onClick={onContinue}
          type="button"
        >
          Review generated results
        </button>
      </div>
    </section>
  );
}

function SceneCard({
  index,
  onInsertSceneAfter,
  onMoveScene,
  onRemoveScene,
  onUpdateScene,
  photo,
  photos,
  scene,
  sceneCount,
}: {
  index: number;
  onInsertSceneAfter: (sceneId: string) => void;
  onMoveScene: (sceneId: string, direction: "up" | "down") => void;
  onRemoveScene: (sceneId: string) => void;
  onUpdateScene: (sceneId: string, updates: Partial<Scene>) => void;
  photo?: MockPhoto;
  photos: MockPhoto[];
  scene: Scene;
  sceneCount: number;
}) {
  return (
    <article className={styles.sceneCard}>
      <div className={styles.sceneControls}>
        <span className={styles.sceneNumber}>{index + 1}</span>
        <button
          className={styles.iconButton}
          disabled={index === 0}
          onClick={() => onMoveScene(scene.id, "up")}
          title="Move scene up"
          type="button"
        >
          Up
        </button>
        <button
          className={styles.iconButton}
          disabled={index === sceneCount - 1}
          onClick={() => onMoveScene(scene.id, "down")}
          title="Move scene down"
          type="button"
        >
          Down
        </button>
      </div>

      <div className={styles.scenePreviewColumn}>
        <SourcePreview photo={photo} />
        <button
          className={styles.textButton}
          onClick={() => onInsertSceneAfter(scene.id)}
          type="button"
        >
          Insert AI scene
        </button>
      </div>

      <div className={styles.sceneEditor}>
        <div className={styles.twoColumn}>
          <label className={styles.field}>
            <span>Scene title</span>
            <input
              onChange={(event) =>
                onUpdateScene(scene.id, { title: event.target.value })
              }
              value={scene.title}
            />
          </label>
          <label className={styles.field}>
            <span>Primary photo</span>
            <select
              onChange={(event) =>
                onUpdateScene(scene.id, {
                  primaryPhotoId: event.target.value,
                })
              }
              value={scene.primaryPhotoId}
            >
              <option value="">No primary photo</option>
              {photos.map((photoOption) => (
                <option key={photoOption.id} value={photoOption.id}>
                  {photoOption.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className={styles.field}>
          <span>Scene description</span>
          <input
            onChange={(event) =>
              onUpdateScene(scene.id, { description: event.target.value })
            }
            value={scene.description}
          />
        </label>

        <label className={styles.field}>
          <span>Generated image prompt</span>
          <textarea
            onChange={(event) =>
              onUpdateScene(scene.id, { prompt: event.target.value })
            }
            rows={3}
            value={scene.prompt}
          />
        </label>

        <div className={styles.twoColumn}>
          <SelectField
            label="Delivered emotion"
            onChange={(value) =>
              onUpdateScene(scene.id, { deliveredEmotion: value })
            }
            options={sceneEmotionOptions}
            value={scene.deliveredEmotion}
          />
          <SelectField
            label="Camera and framing"
            onChange={(value) => onUpdateScene(scene.id, { camera: value })}
            options={cameraOptions}
            value={scene.camera}
          />
          <SelectField
            label="Color and lighting"
            onChange={(value) => onUpdateScene(scene.id, { lighting: value })}
            options={lightingOptions}
            value={scene.lighting}
          />
          <SelectField
            label="Motion direction"
            onChange={(value) => onUpdateScene(scene.id, { motion: value })}
            options={motionOptions}
            value={scene.motion}
          />
        </div>

        <label className={styles.field}>
          <span>User-facing edit notes</span>
          <input
            onChange={(event) =>
              onUpdateScene(scene.id, { notes: event.target.value })
            }
            value={scene.notes}
          />
        </label>
      </div>

      <button
        className={styles.textButton}
        disabled={sceneCount <= 1}
        onClick={() => onRemoveScene(scene.id)}
        type="button"
      >
        Remove
      </button>
    </article>
  );
}

function SelectField({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function GeneratedReviewScreen({
  onBack,
  onUpdateScene,
  photos,
  scenes,
  styleLabel,
  toneLabel,
}: {
  onBack: () => void;
  onUpdateScene: (sceneId: string, updates: Partial<Scene>) => void;
  photos: MockPhoto[];
  scenes: Scene[];
  styleLabel: string;
  toneLabel: string;
}) {
  const photoById = useMemo(
    () => new Map(photos.map((photo) => [photo.id, photo])),
    [photos],
  );

  return (
    <section className={styles.panel}>
      <div className={styles.screenHeader}>
        <div>
          <p className={styles.eyebrow}>Generated result review</p>
          <h2>Compare source photos with static generated samples</h2>
        </div>
        <div className={styles.badgeGroup}>
          <div className={styles.toneBadge}>{toneLabel}</div>
          <div className={styles.toneBadge}>{styleLabel}</div>
        </div>
      </div>

      <div className={styles.comparisonList}>
        {scenes.map((scene) => {
          const photo = photoById.get(scene.primaryPhotoId);
          const adoptedCandidate = candidates.find(
            (candidate) => candidate.id === scene.adoptedCandidateId,
          );
          const activeCandidate = adoptedCandidate ?? candidates[0];

          return (
            <article className={styles.comparisonCard} key={scene.id}>
              <div className={styles.sectionHeadingRow}>
                <div>
                  <h3>{scene.title}</h3>
                  <p>{scene.prompt}</p>
                </div>
                <div className={styles.statusPill}>
                  {scene.adoptedCandidateId === "" ? "Not adopted" : "Adopted"}
                </div>
              </div>

              <div className={styles.reviewPair}>
                <div>
                  <span className={styles.pairLabel}>Original source</span>
                  <SourcePreview photo={photo} />
                </div>
                <div>
                  <span className={styles.pairLabel}>Generated sample</span>
                  <div
                    className={`${styles.generatedPreview} ${activeCandidate?.previewClass ?? styles.swatchSoft}`}
                  >
                    <span>{activeCandidate?.label ?? "Generated sample"}</span>
                  </div>
                </div>
              </div>

              <div className={styles.candidateGrid}>
                {candidates.map((candidate) => (
                  <button
                    className={`${styles.candidateCard} ${
                      scene.adoptedCandidateId === candidate.id
                        ? styles.candidateCardActive
                        : ""
                    }`}
                    key={candidate.id}
                    onClick={() =>
                      onUpdateScene(scene.id, {
                        adoptedCandidateId: candidate.id,
                      })
                    }
                    type="button"
                  >
                    <span
                      className={`${styles.candidatePreview} ${candidate.previewClass}`}
                    />
                    <strong>{candidate.label}</strong>
                    <span>{candidate.detail}</span>
                  </button>
                ))}
              </div>

              <div className={styles.metadataGrid}>
                <span>Model: gpt-image-2</span>
                <span>Preset: Standard</span>
                <span>Retries: {scene.retryCount}</span>
                <span>Output: structured storyboard JSON ready</span>
              </div>

              <div className={styles.actionRowCompact}>
                <button
                  className={styles.secondaryButton}
                  onClick={() =>
                    onUpdateScene(scene.id, {
                      retryCount: scene.retryCount + 1,
                    })
                  }
                  type="button"
                >
                  Retry mock generation
                </button>
                <button
                  className={
                    scene.adoptedCandidateId === ""
                      ? styles.primaryButton
                      : styles.secondaryButton
                  }
                  onClick={() =>
                    onUpdateScene(scene.id, {
                      adoptedCandidateId:
                        scene.adoptedCandidateId === ""
                          ? (activeCandidate?.id ?? "soft-light")
                          : "",
                    })
                  }
                  type="button"
                >
                  {scene.adoptedCandidateId === "" ? "Adopt result" : "Unadopt"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className={styles.actionRow}>
        <button
          className={styles.secondaryButton}
          onClick={onBack}
          type="button"
        >
          Back
        </button>
        <button className={styles.primaryButton} type="button">
          Mock flow complete
        </button>
      </div>
    </section>
  );
}

function PhotoGrid({
  onRemovePhoto,
  photos,
}: {
  onRemovePhoto: (photoId: string) => void;
  photos: MockPhoto[];
}) {
  if (photos.length === 0) {
    return (
      <div className={styles.emptyState}>
        Select local images or add the sample set to continue through the mock.
      </div>
    );
  }

  return (
    <div className={styles.photoGrid}>
      {photos.map((photo) => (
        <article className={styles.photoCard} key={photo.id}>
          <PhotoPreview photo={photo} />
          <div>
            <strong>{photo.name}</strong>
            <span>
              {photo.source === "local" ? "Browser preview" : "Mock sample"}
            </span>
          </div>
          <button
            className={styles.textButton}
            onClick={() => onRemovePhoto(photo.id)}
            type="button"
          >
            Remove
          </button>
        </article>
      ))}
    </div>
  );
}

function SourcePreview({ photo }: { photo?: MockPhoto }) {
  if (photo === undefined) {
    return (
      <div className={styles.sourcePreviewEmpty}>
        <span>No source photo</span>
      </div>
    );
  }

  return <PhotoPreview photo={photo} />;
}

function PhotoPreview({ photo }: { photo: MockPhoto }) {
  if (photo.previewUrl !== undefined) {
    return (
      <img
        alt={`Preview of ${photo.name}`}
        className={styles.photoPreview}
        src={photo.previewUrl}
      />
    );
  }

  return (
    <div className={styles.samplePreview} aria-label={`${photo.name} sample`}>
      <span>{photo.name.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}
