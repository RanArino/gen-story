import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../src/i18n/messages/en.json";
import { PhotosPage } from "../../src/components/photos/PhotosPage";
import { StoryboardPage } from "../../src/components/storyboard/StoryboardPage";
import { clearMediaUrls, setMediaAccount } from "../../src/lib/private-media";

const projectId = location.pathname.split("/")[2] ?? "project-a";
setMediaAccount(document.cookie.includes("fixture-principal=b") ? "b" : "a");
// Test-only controls exercise cache invalidation while the real page stays mounted.
Object.assign(window, {
  mediaFixture: { clear: clearMediaUrls, account: setMediaAccount },
});
createRoot(document.getElementById("root")!).render(
  <NextIntlClientProvider locale="en" messages={messages}>
    {location.pathname.endsWith("/storyboard") ? (
      <StoryboardPage projectId={projectId} />
    ) : (
      <PhotosPage projectId={projectId} />
    )}
  </NextIntlClientProvider>,
);
