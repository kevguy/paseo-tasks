import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import * as PaseoClient from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { onlineManager, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { artifactRpc, detailRpc, listRpc, type TaskDetail, type TaskRow } from "../shared/tasks";

type Filter = "active" | "in_progress" | "open" | "blocked" | "closed" | "all";
type Selection = { hostId: string; id: string };
type ReferenceSelection = { taskId: string; id: string };
type ReadResult<T> = { value: T; requestStartedAt: number; connectedAtStart: boolean };

const filterChoices: Array<{ id: Filter; label: string }> = [
  { id: "active", label: "Active" },
  { id: "in_progress", label: "In progress" },
  { id: "open", label: "Open" },
  { id: "blocked", label: "Blocked" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];
const artifactIdPattern = /^[a-f0-9]{24}$/;
const useHostConnections = PaseoClient.useHosts ?? (() => []);

function displayStatus(status: string) {
  return status.replace(/[_-]+/g, " ").replace(/\b\w/g, character => character.toUpperCase()) || "Unknown";
}

function displayTime(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}

function Section({ title, children, colors }: { title: string; children: ReactNode; colors: PluginScreenProps["theme"]["colors"] }) {
  return <View style={{ gap: 8, padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface1 }}>
    <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 17, fontWeight: "700" }}>{title}</Text>
    {children}
  </View>;
}

function TaskCard({ task, uncertain, colors, onPress }: { task: TaskRow; uncertain: boolean; colors: PluginScreenProps["theme"]["colors"]; onPress: () => void }) {
  const secondary = [task.owner || "Unassigned", task.type, task.priority === null ? null : `P${task.priority}`, task.updatedAt ? `Updated ${displayTime(task.updatedAt)}` : null].filter(Boolean).join(" · ");
  return <Pressable accessibilityRole="button" accessibilityLabel={`${task.title}, ${uncertain ? "cached status unknown" : `recorded ${displayStatus(task.status)} status`}. Open task`} onPress={onPress} style={({ pressed }) => ({ minHeight: 64, padding: 16, gap: 7, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: pressed ? colors.surface2 : colors.surface1 })}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700", flexShrink: 1 }}>{task.title || task.id}</Text>
      <Text style={{ color: uncertain ? "#c79232" : colors.foregroundMuted, fontWeight: "600" }}>{uncertain ? "Unknown · cached" : `Recorded · ${displayStatus(task.status)}`}</Text>
    </View>
    <Text style={{ color: colors.foregroundMuted }}>{task.id}{secondary ? ` · ${secondary}` : ""}</Text>
  </Pressable>;
}

export function TasksScreen(props: PluginScreenProps) {
  const { theme, layout, host } = props;
  const colors = theme.colors;
  const [filter, setFilter] = useState<Filter>("active");
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterHostId, setFilterHostId] = useState(host.id);
  const [searchHostId, setSearchHostId] = useState(host.id);
  const [searchTermHostId, setSearchTermHostId] = useState(host.id);
  const activeFilter: Filter = filterHostId === host.id ? filter : "active";
  const activeSearch = searchHostId === host.id ? search : "";
  const activeSearchTerm = searchTermHostId === host.id ? searchTerm : "";
  const [selection, setSelection] = useState<Selection | null>(null);
  const selectedId = selection?.hostId === host.id ? selection.id : null;
  const [referenceSelection, setReferenceSelection] = useState<ReferenceSelection | null>(null);
  const selectedReferenceId = referenceSelection?.taskId === selectedId ? referenceSelection.id : null;
  const [feedback, setFeedback] = useState("");
  const [showFullContinuation, setShowFullContinuation] = useState(false);
  const [active, setActive] = useState(AppState.currentState !== "background");
  const online = useSyncExternalStore(callback => onlineManager.subscribe(callback), () => onlineManager.isOnline(), () => true);
  const hostConnection = useHostConnections().find(connection => connection.serverId === host.id);
  const connected = online && (hostConnection ? hostConnection.status === "online" : layout.platform === "web");
  const [disconnectedAt, setDisconnectedAt] = useState(0);
  const [viewId] = useState(() => `${Date.now()}-${Math.random()}`);
  const [connectionGeneration, setConnectionGeneration] = useState(0);
  const previousConnected = useRef(connected);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => setActive(state === "active"));
    return () => subscription.remove();
  }, []);
  useEffect(() => { if (!connected) setDisconnectedAt(Date.now()); }, [connected]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(search.trim());
      setSearchTermHostId(host.id);
    }, 220);
    return () => clearTimeout(timer);
  }, [search, host.id]);
  useEffect(() => {
    setSelection(null);
    setReferenceSelection(null);
    setFilter("active");
    setFilterHostId(host.id);
    setSearch("");
    setSearchHostId(host.id);
    setSearchTerm("");
    setSearchTermHostId(host.id);
    setFeedback("");
    setShowFullContinuation(false);
  }, [host.id]);
  useEffect(() => {
    setReferenceSelection(null);
    setFeedback("");
    setShowFullContinuation(false);
  }, [selectedId]);

  const fetchList = useRpc(listRpc);
  const fetchDetail = useRpc(detailRpc);
  const fetchArtifact = useRpc(artifactRpc);
  const list = useQuery({
    queryKey: ["paseo-tasks", "list", host.id, viewId, connectionGeneration, activeFilter, activeSearchTerm],
    queryFn: async (): Promise<ReadResult<Awaited<ReturnType<typeof fetchList>>>> => {
      const requestStartedAt = Date.now();
      const connectedAtStart = connected && onlineManager.isOnline();
      return { value: await fetchList({ filter: activeFilter, search: activeSearchTerm }), requestStartedAt, connectedAtStart };
    },
    enabled: !selectedId,
    refetchInterval: active && !selectedId ? 30000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const detail = useQuery({
    queryKey: ["paseo-tasks", "detail", host.id, viewId, connectionGeneration, selectedId],
    queryFn: async (): Promise<ReadResult<TaskDetail>> => {
      const requestStartedAt = Date.now();
      const connectedAtStart = connected && onlineManager.isOnline();
      return { value: await fetchDetail({ id: selectedId! }), requestStartedAt, connectedAtStart };
    },
    enabled: !!selectedId,
    refetchInterval: active && selectedId ? 30000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const detailValue = detail.data?.value;
  const artifact = useQuery({
    queryKey: ["paseo-tasks", "artifact", host.id, viewId, connectionGeneration, selectedId, selectedReferenceId],
    queryFn: async () => {
      const requestStartedAt = Date.now();
      const connectedAtStart = connected && onlineManager.isOnline();
      const value = await fetchArtifact({ id: selectedId!, referenceId: selectedReferenceId! });
      return { value, requestStartedAt, connectedAtStart };
    },
    enabled: !!selectedId && !!selectedReferenceId && artifactIdPattern.test(selectedReferenceId) && !!detailValue?.available,
    retry: false,
  });

  useEffect(() => {
    const wasConnected = previousConnected.current;
    previousConnected.current = connected;
    if (wasConnected || !connected) return;
    // A new key prevents an in-flight offline-era request from deduplicating
    // the first fresh request after reconnect.
    setConnectionGeneration(generation => generation + 1);
    void list.refetch();
    if (selectedId) void detail.refetch();
    if (selectedId && selectedReferenceId && artifactIdPattern.test(selectedReferenceId)) void artifact.refetch();
  }, [connected, selectedId, selectedReferenceId, list.refetch, detail.refetch, artifact.refetch]);

  const listUncertain = !connected || list.isPaused || list.isError || !!list.data && (!list.data.connectedAtStart || list.data.requestStartedAt <= disconnectedAt);
  const detailUncertain = !connected || detail.isPaused || detail.isError || !!detail.data && (!detail.data.connectedAtStart || detail.data.requestStartedAt <= disconnectedAt);
  const artifactUncertain = !connected || artifact.isPaused || artifact.isError || !!artifact.data && (!artifact.data.connectedAtStart || artifact.data.requestStartedAt <= disconnectedAt);
  const listValue = list.data?.value;
  const detailCanAct = !!selectedId && !!detailValue?.available && !detailUncertain;
  const buttonStyle = { minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, justifyContent: "center" as const, borderWidth: 1, borderColor: colors.border, borderRadius: 10 };
  const textStyle = { color: colors.foreground };
  const mutedStyle = { color: colors.foregroundMuted };

  async function copyContinuation() {
    if (!detailCanAct || !detailValue?.continuation) return;
    try {
      await copyText(detailValue.continuation);
      setFeedback("Continuation copied to this device's clipboard.");
    } catch {
      setFeedback("Could not copy. Select the continuation text and use Copy.");
    }
  }

  const continuationPreview = detailValue?.continuation ? (showFullContinuation ? detailValue.continuation : detailValue.continuation.slice(0, 1800)) : "";
  const selectedReference = detailValue?.references.find(reference => reference.id === selectedReferenceId);
  const artifactValue = artifact.data?.value;

  return <ScrollView style={{ flex: 1, backgroundColor: colors.surface0 }} contentContainerStyle={{ padding: layout.compact ? 16 : 28, paddingBottom: 48, gap: 14 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
      <View style={{ flexShrink: 1 }}>
        <Text style={{ ...mutedStyle, fontSize: 12, letterSpacing: 1.4 }}>TASKS & HANDOFFS</Text>
        <Text accessibilityRole="header" style={{ ...textStyle, fontSize: layout.compact ? 26 : 32, fontWeight: "700", marginTop: 5 }}>{selectedId ? "Task details" : "Pick up where work left off."}</Text>
        <Text style={{ ...mutedStyle, marginTop: 6 }}>{selectedId ? detailValue?.source.host ?? host.id : listValue?.source.host ?? host.id}</Text>
      </View>
      {selectedId ? <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh task" style={buttonStyle} onPress={() => { void detail.refetch(); if (selectedReferenceId && artifactIdPattern.test(selectedReferenceId)) void artifact.refetch(); }}><Text style={textStyle}>{detail.isFetching ? "Refreshing…" : "Refresh"}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to tasks" style={buttonStyle} onPress={() => { setSelection(null); setReferenceSelection(null); setFeedback(""); }}><Text style={textStyle}>← All tasks</Text></Pressable>
      </View> : <Pressable accessibilityRole="button" accessibilityLabel="Refresh tasks" style={buttonStyle} onPress={() => void list.refetch()}><Text style={textStyle}>{list.isFetching ? "Refreshing…" : "Refresh"}</Text></Pressable>}
    </View>

    {(!connected || (selectedId ? detailUncertain : listUncertain)) && <Text accessibilityRole="alert" style={{ color: "#d55a64" }}>{selectedId ? "This task view may be out of date. Current status and actions are unavailable until the host is checked again." : "Live task status unavailable. Any shown statuses are cached and should not be treated as current. Reconnect and refresh."}</Text>}

    {!selectedId && <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {filterChoices.map(choice => <Pressable key={choice.id} accessibilityRole="button" accessibilityLabel={`Filter by recorded ${choice.label.toLowerCase()} status`} accessibilityState={{ selected: activeFilter === choice.id }} onPress={() => { setFilter(choice.id); setFilterHostId(host.id); }} style={{ ...buttonStyle, backgroundColor: activeFilter === choice.id ? colors.surface2 : colors.surface0 }}><Text style={textStyle}>{choice.label}</Text></Pressable>)}
      </View>
      <TextInput accessibilityLabel="Search tasks" placeholder={listValue?.limited ? "Search this view or enter an exact task ID" : "Search title, ID or owner"} placeholderTextColor={colors.foregroundMuted} autoCapitalize="none" maxLength={200} value={activeSearch} onChangeText={value => { setSearch(value); setSearchHostId(host.id); }} style={{ ...buttonStyle, ...textStyle, minHeight: 48 }} />
      {list.isPending && <Text style={mutedStyle}>Reading saved tasks…</Text>}
      {list.isError && <Text accessibilityRole="alert" style={{ color: "#d55a64" }}>Could not read tasks. {list.error instanceof Error ? list.error.message : "Refresh to try again."}</Text>}
      {listValue?.error && <Text accessibilityRole="alert" style={{ color: "#d55a64" }}>{listValue.error}. Task status is unavailable.</Text>}
      {listValue && !listValue.available && !listValue.error && <Text accessibilityRole="alert" style={{ color: "#d55a64" }}>The task source is unavailable from this host.</Text>}
      {listValue?.source.warnings.map((warning, index) => <Text key={index} accessibilityRole="alert" style={mutedStyle}>{warning}</Text>)}
      {listValue?.limited && <Text style={mutedStyle}>Showing a bounded list. This is not a total task count.</Text>}
      {listValue?.available && listValue.tasks.map(task => <TaskCard key={task.id} task={task} uncertain={listUncertain} colors={colors} onPress={() => { setSelection({ hostId: host.id, id: task.id }); setReferenceSelection(null); setFeedback(""); }} />)}
      {listValue?.available && !listValue.tasks.length && <Text style={mutedStyle}>No tasks match this filter.</Text>}
      <Text style={{ ...mutedStyle, fontSize: 12 }}>Read-only task and handoff records. No tasks are edited or started here.</Text>
    </>}

    {selectedId && <>
      {detail.isPending && <Text style={mutedStyle}>Reading the saved task record…</Text>}
      {detail.isError && <Text accessibilityRole="alert" style={{ color: "#d55a64" }}>Could not read this task. {detail.error instanceof Error ? detail.error.message : "Return to the list and try again."}</Text>}
      {detailValue?.error && <Text accessibilityRole="alert" style={{ color: "#d55a64" }}>{detailValue.error}. Saved details may be incomplete.</Text>}
      {detailValue?.source.warnings.map((warning, index) => <Text key={index} accessibilityRole="alert" style={mutedStyle}>{warning}</Text>)}
      {detailValue && !detailValue.available && <Text style={mutedStyle}>This task is not available from the selected host.</Text>}
      {detailValue?.task && <>
        <View style={{ gap: 6 }}>
          <Text style={{ ...textStyle, fontSize: 21, fontWeight: "700" }}>{detailValue.task.title || detailValue.task.id}</Text>
          <Text style={{ ...mutedStyle, fontSize: 13 }}>{detailValue.task.id} · {detailUncertain ? "Unknown · cached" : `Recorded status: ${displayStatus(detailValue.task.status)}`} · {detailValue.task.priority === null ? "Priority not set" : `Priority P${detailValue.task.priority}`} · {detailValue.task.owner || "Unassigned"}</Text>
          <Text style={mutedStyle}>Updated {displayTime(detailValue.task.updatedAt)}</Text>
        </View>

        <Section title="Record source" colors={colors}>
          <Text style={mutedStyle}>Host: {detailValue.source.host}</Text>
          {detailValue.source.path && <Text selectable style={mutedStyle}>Source: {detailValue.source.path}</Text>}
          <Text style={mutedStyle}>Observed {displayTime(detailValue.source.observedAt)}</Text>
          {detailValue.source.revision && <Text style={mutedStyle}>Recorded revision: {detailValue.source.revision}</Text>}
        </Section>

        <Section title="Description" colors={colors}><Text selectable style={textStyle}>{detailValue.description || "No description recorded."}</Text></Section>
        <Section title="Notes" colors={colors}><Text selectable style={textStyle}>{detailValue.notes || "No notes recorded."}</Text></Section>
        <Section title="Acceptance criteria" colors={colors}>
          <Text style={mutedStyle}>From the selected task record.</Text>
          <Text selectable style={textStyle}>{detailValue.acceptance || "No acceptance criteria recorded."}</Text>
        </Section>

        <Section title="Dependencies" colors={colors}>
          {detailValue.dependencies.length ? detailValue.dependencies.map((dependency, index) => <View key={`${dependency.id}-${index}`} style={{ gap: 3, paddingVertical: 6, borderBottomWidth: index === detailValue.dependencies.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
            <Text style={textStyle}>{dependency.title || dependency.id}</Text>
            <Text style={mutedStyle}>{dependency.relationship} · Recorded status: {displayStatus(dependency.status)} · {dependency.id}</Text>
          </View>) : <Text style={mutedStyle}>No dependencies recorded.</Text>}
        </Section>

        <Section title="Latest handoff" colors={colors}>
          {detailValue.handoff ? <>
            <Text style={mutedStyle}>{displayStatus(detailValue.handoff.kind)}{detailValue.handoff.author ? ` · ${detailValue.handoff.author}` : ""} · {displayTime(detailValue.handoff.createdAt)}</Text>
            <Text selectable style={textStyle}>{detailValue.handoff.text || "No handoff text recorded."}</Text>
          </> : <Text style={mutedStyle}>No handoff is recorded for this task.</Text>}
        </Section>

        <Section title="Last recorded session" colors={colors}>
          {detailValue.run?.found ? <>
            <Text style={textStyle}>Run {detailValue.run.id} · Recorded {displayTime(detailValue.run.timestamp)}</Text>
            {detailValue.run.project && <Text style={mutedStyle}>Repository: {detailValue.run.project}</Text>}
            {detailValue.run.branch && <Text style={mutedStyle}>Branch: {detailValue.run.branch}</Text>}
            {detailValue.run.syncStatus && <Text style={mutedStyle}>Sync recorded: {detailValue.run.syncStatus}</Text>}
            <Text style={mutedStyle}>This is what was recorded then; it does not confirm the repository or sync state now.</Text>
          </> : detailValue.run ? <Text style={mutedStyle}>Run {detailValue.run.id} was not available in the recorded session history.</Text> : <Text style={mutedStyle}>No session handoff is linked to this task.</Text>}
        </Section>

        <Section title="Continue this task" colors={colors}>
          <Text style={mutedStyle}>{detailValue.continuation ? "Copy a continuation packet when you choose to resume. No agent is started." : "No continuation packet is recorded."}</Text>
          {continuationPreview ? <Text selectable style={{ ...textStyle, fontFamily: "monospace", fontSize: 12 }}>{continuationPreview}</Text> : null}
          {!showFullContinuation && detailValue.continuation.length > 1800 ? <Pressable accessibilityRole="button" accessibilityLabel="Show full continuation text" style={buttonStyle} onPress={() => setShowFullContinuation(true)}><Text style={textStyle}>Show full continuation text to select manually</Text></Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Copy continuation packet" accessibilityState={{ disabled: !detailCanAct || !detailValue.continuation }} disabled={!detailCanAct || !detailValue.continuation} onPress={() => void copyContinuation()} style={{ ...buttonStyle, opacity: !detailCanAct || !detailValue.continuation ? 0.45 : 1 }}><Text style={textStyle}>Copy continuation</Text></Pressable>
          {feedback ? <Text accessibilityLiveRegion="polite" style={mutedStyle}>{feedback}</Text> : null}
        </Section>

        <Section title="Referenced files" colors={colors}>
          {detailValue.references.length ? detailValue.references.map(reference => {
            const validReference = artifactIdPattern.test(reference.id);
            const disabled = !detailCanAct || !validReference;
            return <Pressable key={reference.id} accessibilityRole="button" accessibilityLabel={`Preview ${reference.label}`} accessibilityState={{ disabled }} disabled={disabled} onPress={() => { setReferenceSelection({ taskId: selectedId, id: reference.id }); setFeedback(""); }} style={{ ...buttonStyle, opacity: disabled ? 0.45 : 1 }}>
              <Text style={textStyle}>{reference.label}</Text>
              {!validReference ? <Text style={mutedStyle}>Preview unavailable for this reference.</Text> : null}
            </Pressable>;
          }) : <Text style={mutedStyle}>No file references are recorded for this task.</Text>}
          {selectedReference && <View style={{ gap: 8, paddingTop: 8 }}>
            <Text style={{ ...textStyle, fontWeight: "600" }}>{selectedReference.label}</Text>
            {artifact.isPending && <Text style={mutedStyle}>Reading the selected file preview…</Text>}
            {artifact.isError && <Text accessibilityRole="alert" style={{ color: "#d55a64" }}>Could not read this file preview.</Text>}
            {(artifactUncertain || !detailCanAct) && <Text accessibilityRole="alert" style={{ color: "#d55a64" }}>This task or file cannot be confirmed. The file preview is hidden until a fresh check succeeds.</Text>}
            {!artifactUncertain && detailCanAct && artifactValue?.error && <Text accessibilityRole="alert" style={{ color: "#d55a64" }}>{artifactValue.error}</Text>}
            {(artifact.isError || artifactValue?.error) && <Pressable accessibilityRole="button" accessibilityLabel="Retry file preview" disabled={!detailCanAct} onPress={() => void artifact.refetch()} style={{ ...buttonStyle, opacity: detailCanAct ? 1 : 0.45 }}><Text style={textStyle}>Retry preview</Text></Pressable>}
            {!artifactUncertain && detailCanAct && artifactValue?.available && <>
              <Text selectable style={mutedStyle}>{artifactValue.path}</Text>
              {artifactValue.sha256 && <Text style={mutedStyle}>SHA-256 {artifactValue.sha256}</Text>}
              <Text style={mutedStyle}>Preview observed {displayTime(artifactValue.observedAt)}</Text>
              <Text selectable style={{ ...textStyle, fontFamily: "monospace", fontSize: 12, backgroundColor: colors.surface0, padding: 12, borderRadius: 8 }}>{artifactValue.text || "The selected file has no readable text preview."}</Text>
            </>}
          </View>}
        </Section>
      </>}
    </>}
  </ScrollView>;
}
