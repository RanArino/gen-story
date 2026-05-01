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

type Project = {
  id: string;
  title: string;
  occasion: string;
  updatedAt: string;
  photoCount: number;
  progress: string;
};

type PhotoUsage = "hero" | "support" | "reference" | "omit";

type MockPhoto = {
  id: string;
  name: string;
  source: "local" | "sample";
  previewUrl?: string;
  usage: PhotoUsage;
};

type LocalPhoto = MockPhoto & {
  source: "local";
  previewUrl: string;
};

type ToneId = "warm" | "cinematic" | "playful" | "quiet";

type Candidate = {
  id: string;
  label: string;
  detail: string;
  swatchClass?: string;
};

type Scene = {
  id: string;
  title: string;
  prompt: string;
  primaryPhotoId: string;
  adoptedCandidateId: string;
};

type DraftProject = {
  title: string;
  occasion: string;
};

const screens: Array<{ id: ScreenId; label: string }> = [
  { id: "projects", label: "Projects" },
  { id: "create", label: "Create" },
  { id: "upload", label: "Upload" },
  { id: "manage", label: "Manage" },
  { id: "emotion", label: "Emotion" },
  { id: "storyboard", label: "Storyboard" },
  { id: "compare", label: "Compare" },
];

const initialProjects: Project[] = [
  {
    id: "anniversary",
    title: "Anniversary Dinner",
    occasion: "Wedding anniversary",
    updatedAt: "Today 09:42",
    photoCount: 18,
    progress: "Storyboard draft",
  },
  {
    id: "graduation",
    title: "Graduation Album",
    occasion: "Family celebration",
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
    usage: "hero",
  },
  {
    id: "sample-table",
    name: "Dinner table",
    source: "sample",
    usage: "support",
  },
  {
    id: "sample-toast",
    name: "Toast moment",
    source: "sample",
    usage: "reference",
  },
];

const toneOptions: Array<{ id: ToneId; label: string; description: string }> = [
  {
    id: "warm",
    label: "Warm",
    description: "Soft family story with gentle color and steady pacing.",
  },
  {
    id: "cinematic",
    label: "Cinematic",
    description: "Dramatic framing, deeper contrast, and film-like beats.",
  },
  {
    id: "playful",
    label: "Playful",
    description: "Bright expressions, lively transitions, and upbeat scenes.",
  },
  {
    id: "quiet",
    label: "Quiet",
    description: "Minimal composition, subtle emotion, and calm narration.",
  },
];

const candidates: Candidate[] = [
  {
    id: "soft-light",
    label: "Soft light",
    detail: "Pastel background with close portrait framing",
    swatchClass: styles.swatchSoft,
  },
  {
    id: "editorial",
    label: "Editorial",
    detail: "Magazine crop with strong foreground subject",
    swatchClass: styles.swatchEditorial,
  },
  {
    id: "memory",
    label: "Memory",
    detail: "Layered photo treatment with warm vignette",
    swatchClass: styles.swatchMemory,
  },
];

const defaultScenes: Scene[] = [
  {
    id: "scene-open",
    title: "Opening memory",
    prompt:
      "Begin with the guest of honor arriving at the table, surrounded by familiar faces and warm light.",
    primaryPhotoId: "",
    adoptedCandidateId: "soft-light",
  },
  {
    id: "scene-middle",
    title: "Shared celebration",
    prompt:
      "Show the central celebration moment with expressive reactions and small personal details in the setting.",
    primaryPhotoId: "",
    adoptedCandidateId: "editorial",
  },
  {
    id: "scene-close",
    title: "Closing keepsake",
    prompt:
      "End on a quiet keepsake image that feels complete, personal, and ready to share with family.",
    primaryPhotoId: "",
    adoptedCandidateId: "memory",
  },
];

const createScene = (index: number): Scene => ({
  id: `scene-${Date.now()}-${index}`,
  title: `Scene ${index}`,
  prompt: "Describe the important story beat for this generated image.",
  primaryPhotoId: "",
  adoptedCandidateId: "soft-light",
});

const isLocalPhoto = (photo: MockPhoto): photo is LocalPhoto =>
  photo.source === "local" && typeof photo.previewUrl === "string";

export function MockFlowClient() {
  const [screen, setScreen] = useState<ScreenId>("projects");
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [currentProjectId, setCurrentProjectId] = useState(
    initialProjects[0]?.id ?? "",
  );
  const [draftProject, setDraftProject] = useState<DraftProject>({
    title: "Family Story Set",
    occasion: "Anniversary gift",
  });
  const [photos, setPhotos] = useState<MockPhoto[]>(samplePhotos);
  const [tone, setTone] = useState<ToneId>("warm");
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

  const usablePhotos = photos.filter((photo) => photo.usage !== "omit");
  const adoptedCount = scenes.filter(
    (scene) => scene.adoptedCandidateId !== "",
  ).length;
  const selectedTone = toneOptions.find((option) => option.id === tone);
  const canAdvanceFromUpload = photos.length > 0;

  const navigateNext = () => {
    const nextScreen = screens[currentScreenIndex + 1];
    if (nextScreen !== undefined) {
      setScreen(nextScreen.id);
    }
  };

  const navigateBack = () => {
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
    setScreen("upload");
  };

  const createProject = () => {
    const nextProject: Project = {
      id: `project-${Date.now()}`,
      title: draftProject.title.trim() || "Untitled story",
      occasion: draftProject.occasion.trim() || "Personal story",
      updatedAt: "Just now",
      photoCount: 0,
      progress: "Photo upload",
    };

    setProjects((previous) => [nextProject, ...previous]);
    setCurrentProjectId(nextProject.id);
    setPhotos([]);
    setScenes(defaultScenes);
    setTone("warm");
    setScreen("upload");
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
      return {
        id: `local-${Date.now()}-${index}-${file.name}`,
        name: file.name,
        source: "local",
        previewUrl: URL.createObjectURL(file),
        usage: index === 0 ? "hero" : "support",
      };
    });

    setPhotos((previous) => [...previous, ...nextPhotos]);
    setProjects((previous) =>
      previous.map((project) =>
        project.id === currentProjectId
          ? {
              ...project,
              photoCount: project.photoCount + nextPhotos.length,
              progress: "Photo review",
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

    setPhotos((previous) => [...previous, ...missingSamples]);
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

  const updatePhotoUsage = (photoId: string, usage: PhotoUsage) => {
    setPhotos((previous) =>
      previous.map((photo) =>
        photo.id === photoId ? { ...photo, usage } : photo,
      ),
    );
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
    setScenes((previous) => [...previous, createScene(previous.length + 1)]);
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
                onClick={() => setScreen(item.id)}
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
              label="Adopted"
              value={`${adoptedCount}/${scenes.length}`}
            />
          </div>
        </header>

        <div className={styles.content}>
          {screen === "projects" && (
            <ProjectListScreen
              currentProjectId={currentProjectId}
              onCreate={() => setScreen("create")}
              onSelect={selectProject}
              projects={projects}
            />
          )}
          {screen === "create" && (
            <ProjectCreationScreen
              draftProject={draftProject}
              onBack={() => setScreen("projects")}
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
            <PhotoManagementScreen
              onBack={navigateBack}
              onContinue={navigateNext}
              onRemovePhoto={removePhoto}
              onUpdateUsage={updatePhotoUsage}
              photos={photos}
            />
          )}
          {screen === "emotion" && (
            <EmotionSelectionScreen
              onBack={navigateBack}
              onContinue={navigateNext}
              onToneChange={setTone}
              tone={tone}
            />
          )}
          {screen === "storyboard" && (
            <StoryboardEditorScreen
              onAddScene={addScene}
              onBack={navigateBack}
              onContinue={navigateNext}
              onMoveScene={moveScene}
              onRemoveScene={removeScene}
              onUpdateScene={updateScene}
              photos={usablePhotos}
              scenes={scenes}
            />
          )}
          {screen === "compare" && (
            <GeneratedComparisonScreen
              onBack={navigateBack}
              onUpdateScene={updateScene}
              scenes={scenes}
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
        <label className={styles.field}>
          <span>Occasion</span>
          <input
            onChange={(event) =>
              onDraftChange({ ...draftProject, occasion: event.target.value })
            }
            value={draftProject.occasion}
          />
        </label>
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
          <h2>Select local images for preview</h2>
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
          Review selected photos
        </button>
      </div>
    </section>
  );
}

function PhotoManagementScreen({
  onBack,
  onContinue,
  onRemovePhoto,
  onUpdateUsage,
  photos,
}: {
  onBack: () => void;
  onContinue: () => void;
  onRemovePhoto: (photoId: string) => void;
  onUpdateUsage: (photoId: string, usage: PhotoUsage) => void;
  photos: MockPhoto[];
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.screenHeader}>
        <div>
          <p className={styles.eyebrow}>Photo management</p>
          <h2>Mark how each image should be used</h2>
        </div>
      </div>

      <div className={styles.managementList}>
        {photos.map((photo) => (
          <article className={styles.managementRow} key={photo.id}>
            <PhotoPreview photo={photo} />
            <div className={styles.managementDetails}>
              <strong>{photo.name}</strong>
              <span>
                {photo.source === "local" ? "Local preview" : "Sample mock"}
              </span>
            </div>
            <select
              aria-label={`Usage for ${photo.name}`}
              onChange={(event) =>
                onUpdateUsage(photo.id, event.target.value as PhotoUsage)
              }
              value={photo.usage}
            >
              <option value="hero">Hero</option>
              <option value="support">Support</option>
              <option value="reference">Reference</option>
              <option value="omit">Omit</option>
            </select>
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
          Choose emotion
        </button>
      </div>
    </section>
  );
}

function EmotionSelectionScreen({
  onBack,
  onContinue,
  onToneChange,
  tone,
}: {
  onBack: () => void;
  onContinue: () => void;
  onToneChange: (tone: ToneId) => void;
  tone: ToneId;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.screenHeader}>
        <div>
          <p className={styles.eyebrow}>Emotion selection</p>
          <h2>Set the story tone</h2>
        </div>
      </div>

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
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
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
  onMoveScene,
  onRemoveScene,
  onUpdateScene,
  photos,
  scenes,
}: {
  onAddScene: () => void;
  onBack: () => void;
  onContinue: () => void;
  onMoveScene: (sceneId: string, direction: "up" | "down") => void;
  onRemoveScene: (sceneId: string) => void;
  onUpdateScene: (sceneId: string, updates: Partial<Scene>) => void;
  photos: MockPhoto[];
  scenes: Scene[];
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.screenHeader}>
        <div>
          <p className={styles.eyebrow}>Storyboard editing</p>
          <h2>Shape the generated sequence</h2>
        </div>
        <button
          className={styles.secondaryButton}
          onClick={onAddScene}
          type="button"
        >
          Add scene
        </button>
      </div>

      <div className={styles.sceneList}>
        {scenes.map((scene, index) => (
          <article className={styles.sceneCard} key={scene.id}>
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
                disabled={index === scenes.length - 1}
                onClick={() => onMoveScene(scene.id, "down")}
                title="Move scene down"
                type="button"
              >
                Down
              </button>
            </div>

            <div className={styles.sceneEditor}>
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
                <span>Prompt</span>
                <textarea
                  onChange={(event) =>
                    onUpdateScene(scene.id, { prompt: event.target.value })
                  }
                  rows={4}
                  value={scene.prompt}
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
                  {photos.map((photo) => (
                    <option key={photo.id} value={photo.id}>
                      {photo.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <button
              className={styles.textButton}
              disabled={scenes.length <= 1}
              onClick={() => onRemoveScene(scene.id)}
              type="button"
            >
              Remove
            </button>
          </article>
        ))}
      </div>

      <div className={styles.validationLine}>
        {scenes.length > 0
          ? `${scenes.length} scene${scenes.length === 1 ? "" : "s"} ready for comparison.`
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
          Compare generated images
        </button>
      </div>
    </section>
  );
}

function GeneratedComparisonScreen({
  onBack,
  onUpdateScene,
  scenes,
  toneLabel,
}: {
  onBack: () => void;
  onUpdateScene: (sceneId: string, updates: Partial<Scene>) => void;
  scenes: Scene[];
  toneLabel: string;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.screenHeader}>
        <div>
          <p className={styles.eyebrow}>Generated image comparison</p>
          <h2>Adopt one mock candidate per scene</h2>
        </div>
        <div className={styles.toneBadge}>{toneLabel}</div>
      </div>

      <div className={styles.comparisonList}>
        {scenes.map((scene) => (
          <article className={styles.comparisonCard} key={scene.id}>
            <div>
              <h3>{scene.title}</h3>
              <p>{scene.prompt}</p>
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
                    className={`${styles.candidatePreview} ${candidate.swatchClass}`}
                  />
                  <strong>{candidate.label}</strong>
                  <span>{candidate.detail}</span>
                </button>
              ))}
            </div>
          </article>
        ))}
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
