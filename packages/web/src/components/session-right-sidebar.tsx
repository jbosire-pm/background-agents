"use client";

import { useMemo } from "react";
import {
  CollapsibleSection,
  ParticipantsSection,
  MetadataSection,
  TasksSection,
  FilesChangedSection,
} from "./sidebar";
import { GlobeIcon, TerminalIcon } from "@/components/ui/icons";
import { ChildSessionsSection } from "./sidebar/child-sessions-section";
import { extractLatestTasks } from "@/lib/tasks";
import { extractChangedFiles } from "@/lib/files";
import type { Artifact, SandboxEvent } from "@/types/session";
import type { ParticipantPresence, SessionState } from "@open-inspect/shared";

interface SessionRightSidebarProps {
  sessionState: SessionState | null;
  participants: ParticipantPresence[];
  events: SandboxEvent[];
  artifacts: Artifact[];
}

export type SessionRightSidebarContentProps = SessionRightSidebarProps;

export function SessionRightSidebarContent({
  sessionState,
  participants,
  events,
  artifacts,
}: SessionRightSidebarContentProps) {
  const tasks = useMemo(() => extractLatestTasks(events), [events]);
  const filesChanged = useMemo(() => extractChangedFiles(events), [events]);

  if (!sessionState) {
    return (
      <div className="p-4">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-muted w-3/4" />
          <div className="h-4 bg-muted w-1/2" />
          <div className="h-4 bg-muted w-2/3" />
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Participants */}
      <div className="px-4 py-4 border-b border-border-muted">
        <ParticipantsSection participants={participants} />
      </div>

      {/* Metadata */}
      <div className="px-4 py-4 border-b border-border-muted">
        <MetadataSection
          createdAt={sessionState.createdAt}
          model={sessionState.model}
          reasoningEffort={sessionState.reasoningEffort}
          baseBranch={sessionState.baseBranch}
          branchName={sessionState.branchName || undefined}
          repoOwner={sessionState.repoOwner}
          repoName={sessionState.repoName}
          artifacts={artifacts}
          parentSessionId={sessionState.parentSessionId}
        />
      </div>

      {/* Tasks */}
      {tasks.length > 0 && (
        <CollapsibleSection title="Tasks" defaultOpen={true}>
          <TasksSection tasks={tasks} />
        </CollapsibleSection>
      )}

      {/* Child Sessions */}
      <ChildSessionsSection sessionId={sessionState.id} />

      {/* Files Changed */}
      {filesChanged.length > 0 && (
        <CollapsibleSection title="Files changed" defaultOpen={true}>
          <FilesChangedSection files={filesChanged} />
        </CollapsibleSection>
      )}

      {/* MCP Servers */}
      {sessionState.mcpServers && sessionState.mcpServers.length > 0 && (
        <CollapsibleSection title="MCP Servers" defaultOpen={false}>
          <div className="space-y-1">
            {sessionState.mcpServers.map((server: { id: string; name: string; type: string; url?: string | null; enabled: boolean }) => (
              <div key={server.id} className="flex items-center gap-2 px-1 py-1">
                {server.type === "remote" ? (
                  <GlobeIcon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                ) : (
                  <TerminalIcon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                )}
                <span className="text-xs text-foreground">{server.name}</span>
                <span className={`ml-auto text-xs ${server.enabled ? "text-green-500" : "text-muted-foreground"}`}>
                  {server.enabled ? "active" : "disabled"}
                </span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Artifacts info when no specific sections are populated */}
      {tasks.length === 0 && filesChanged.length === 0 && artifacts.length === 0 && (
        <div className="px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Tasks and file changes will appear here as the agent works.
          </p>
        </div>
      )}
    </>
  );
}

export function SessionRightSidebar({
  sessionState,
  participants,
  events,
  artifacts,
}: SessionRightSidebarProps) {
  return (
    <aside className="w-80 border-l border-border-muted overflow-y-auto hidden lg:block">
      <SessionRightSidebarContent
        sessionState={sessionState}
        participants={participants}
        events={events}
        artifacts={artifacts}
      />
    </aside>
  );
}
