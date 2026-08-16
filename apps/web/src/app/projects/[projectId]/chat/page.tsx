import { AgentChatPanel } from "../../../../components/agent-chat/AgentChatPanel";
import { AppShell } from "../../../../components/AppShell";

type Props = { params: Promise<{ projectId: string }> };

export default async function ProjectChatPage({ params }: Props) {
  const { projectId } = await params;
  return (
    <AppShell projectId={projectId}>
      <AgentChatPanel projectId={projectId} />
    </AppShell>
  );
}
