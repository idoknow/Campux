import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { AuthenticatedMe, AiAnalysisItem, AiBackfillBatch, AiEntity, AiEntityEvidence, AiOverview, AiRules, TenantAiSettings } from "@/types/app";
import {
  ActivityIcon,
  BotIcon,
  DatabaseIcon,
  GitBranchIcon,
  InfoIcon,
  KeyRoundIcon,
  Layers3Icon,
  Maximize2Icon,
  MinusIcon,
  MoveIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  SearchIcon,
  SparklesIcon,
  StopCircleIcon,
  TestTube2Icon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { statusLabels } from "@/lib/app-model";
import { EmptyCard, LoadingBlock } from "@/components/app/utility";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useTheme } from "@/features/theme/theme";

type AiSettingsForm = {
  enabled: boolean;
  mode: "local" | "llm";
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  clearApiKey: boolean;
  temperature: number;
  timeoutSeconds: number;
  tone: string;
  strictPrivacy: boolean;
  allowedCategoriesText: string;
  modelingKeywordsText: string;
  modelingNotes: string;
};

type PanelTab = "overview" | "backfill" | "recent";

type LlmTestResult = {
  ok: boolean;
  mode: "local" | "llm";
  provider: string;
  model: string;
  baseUrl: string;
  latencyMs: number | null;
  message: string;
};

type FloatingWindowPosition = {
  right: number;
  top: number;
};

type FloatingWindowKey = "tools" | "panel" | "entity";

type GraphTransform = {
  x: number;
  y: number;
  scale: number;
};

type GraphSize = {
  width: number;
  height: number;
};

type GraphBounds = GraphSize & {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
};

type GraphColorTheme = {
  surface: string;
  grid: string;
  labelText: string;
  labelStroke: string;
  labelBg: string;
  nodeHalo: string;
  nodeStroke: string;
  selectedHalo: string;
  selectedStroke: string;
  searchFill: string;
  searchStroke: string;
  edges: Record<string, string>;
  nodes: Record<string, string>;
};

type FloatingWindowLayout = {
  positions: Record<FloatingWindowKey, FloatingWindowPosition>;
  minimized: Record<FloatingWindowKey, boolean>;
};

const floatingWindowDefaults: FloatingWindowLayout = {
  positions: {
    tools: { right: 12, top: 12 },
    panel: { right: 12, top: 178 },
    entity: { right: 12, top: 540 },
  },
  minimized: {
    tools: false,
    panel: false,
    entity: false,
  },
};

const floatingWindowStoragePrefix = "campux.ai.floating-windows.v1";

const lightGraphTheme: GraphColorTheme = {
  surface: "#f1f5f9",
  grid: "rgba(148, 163, 184, 0.18)",
  labelText: "#475569",
  labelStroke: "#f8fafc",
  labelBg: "#ffffff",
  nodeHalo: "#ffffff",
  nodeStroke: "#ffffff",
  selectedHalo: "#2563eb",
  selectedStroke: "#1d4ed8",
  searchFill: "#fef3c7",
  searchStroke: "#f59e0b",
  edges: {
    CO_OCCURS: "#0f766e",
    CATEGORY: "#16a34a",
    TYPE: "#7c3aed",
    DEFAULT: "#94a3b8",
  },
  nodes: {
    tenant: "#2563eb",
    type: "#7c3aed",
    category: "#16a34a",
    location: "#0ea5e9",
    class: "#f59e0b",
    person_alias: "#ec4899",
    organization: "#8b5cf6",
    topic: "#14b8a6",
    service: "#22c55e",
    contact: "#64748b",
    event: "#ef4444",
    default: "#38bdf8",
  },
};

const darkGraphTheme: GraphColorTheme = {
  surface: "#0b1120",
  grid: "rgba(148, 163, 184, 0.12)",
  labelText: "#cbd5e1",
  labelStroke: "#0b1120",
  labelBg: "#111827",
  nodeHalo: "#111827",
  nodeStroke: "#1e293b",
  selectedHalo: "#60a5fa",
  selectedStroke: "#93c5fd",
  searchFill: "#451a03",
  searchStroke: "#fbbf24",
  edges: {
    CO_OCCURS: "#2dd4bf",
    CATEGORY: "#4ade80",
    TYPE: "#a78bfa",
    DEFAULT: "#64748b",
  },
  nodes: {
    tenant: "#3b82f6",
    type: "#8b5cf6",
    category: "#22c55e",
    location: "#38bdf8",
    class: "#fbbf24",
    person_alias: "#f472b6",
    organization: "#a78bfa",
    topic: "#2dd4bf",
    service: "#4ade80",
    contact: "#94a3b8",
    event: "#fb7185",
    default: "#67e8f9",
  },
};

const entityTypeLabels: Record<string, string> = {
  location: "地点",
  class: "班级",
  person_alias: "人物",
  organization: "组织",
  topic: "话题",
  event: "活动",
  service: "服务",
  contact: "联系方式",
};

const backfillStatusLabels: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  completed_with_errors: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export function AiPage({ me }: { me: AuthenticatedMe & { currentTenant: NonNullable<AuthenticatedMe["currentTenant"]>; currentMembership: NonNullable<AuthenticatedMe["currentMembership"]> } }) {
  const { resolvedTheme } = useTheme();
  const [overview, setOverview] = useState<AiOverview | null>(null);
  const [form, setForm] = useState<AiSettingsForm | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [graphSearch, setGraphSearch] = useState("");
  const [panel, setPanel] = useState<PanelTab>("overview");
  const [panelOpen, setPanelOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null);
  const [floatingLayout, setFloatingLayout] = useState<FloatingWindowLayout>(() => readFloatingWindowLayout(me.currentTenant.id));
  const [graphTransform, setGraphTransform] = useState<GraphTransform>({ x: 0, y: 0, scale: 1 });
  const isAdmin = me.currentMembership.role === "admin";
  const graphTheme = resolvedTheme === "dark" ? darkGraphTheme : lightGraphTheme;
  const windowPositions = floatingLayout.positions;
  const minimizedWindows = floatingLayout.minimized;

  useEffect(() => {
    void refresh().catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取 AI 数据");
    });
  }, [me.currentTenant.id]);

  useEffect(() => {
    setFloatingLayout(readFloatingWindowLayout(me.currentTenant.id));
  }, [me.currentTenant.id]);

  useEffect(() => {
    writeFloatingWindowLayout(me.currentTenant.id, floatingLayout);
  }, [floatingLayout, me.currentTenant.id]);

  useEffect(() => {
    function keepWindowsInView() {
      setFloatingLayout((current) => normalizeFloatingWindowLayout(current));
    }
    keepWindowsInView();
    window.addEventListener("resize", keepWindowsInView);
    return () => window.removeEventListener("resize", keepWindowsInView);
  }, []);

  useEffect(() => {
    if (!selectedEntityId || overview?.entities.some((entity) => entity.id === selectedEntityId)) {
      return;
    }
    setSelectedEntityId(null);
  }, [overview, selectedEntityId]);

  async function refresh() {
    const firstLoad = overview === null;
    if (firstLoad) {
      setLoading(true);
    }
    try {
      const data = await api<AiOverview>("/api/ai/overview");
      setOverview(data);
      setForm(toForm(data.settings));
    } finally {
      if (firstLoad) {
        setLoading(false);
      }
    }
  }

  function buildSettingsPayload() {
    if (!form) return null;
    const rules: AiRules = {
      tone: form.tone.trim(),
      strictPrivacy: form.strictPrivacy,
      allowedCategories: lines(form.allowedCategoriesText),
      modelingKeywords: lines(form.modelingKeywordsText),
      modelingNotes: form.modelingNotes.trim(),
    };
    return {
      enabled: form.enabled,
      mode: form.mode,
      provider: form.provider.trim(),
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      apiKey: form.apiKey.trim() || undefined,
      clearApiKey: form.clearApiKey,
      temperature: form.temperature,
      timeoutSeconds: form.timeoutSeconds,
      rules,
    };
  }

  async function saveSettings() {
    const payload = buildSettingsPayload();
    if (!payload) return;
    setBusy(true);
    try {
      await api<{ settings: TenantAiSettings }>("/api/admin/ai/settings", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      await refresh();
      setTestResult(null);
      toast.success("AI 设置已保存。");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "保存 AI 设置失败");
    } finally {
      setBusy(false);
    }
  }

  async function testSettings() {
    const payload = buildSettingsPayload();
    if (!payload) return;
    setTesting(true);
    try {
      const response = await api<{ result: LlmTestResult }>("/api/admin/ai/settings/test", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setTestResult(response.result);
      if (response.result.ok) {
        toast.success(response.result.message);
      } else {
        toast.error(response.result.message);
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "LLM 测试失败");
    } finally {
      setTesting(false);
    }
  }

  async function refreshSnapshot() {
    setBusy(true);
    try {
      await api("/api/ai/snapshot/refresh", { method: "POST" });
      await refresh();
      toast.success("学校模型已刷新。");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "刷新失败");
    } finally {
      setBusy(false);
    }
  }

  async function analyzePost(postId: string) {
    setBusy(true);
    try {
      await api(`/api/ai/posts/${encodeURIComponent(postId)}/analyze`, { method: "POST" });
      await refresh();
      toast.success("稿件已重新分析。");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "分析失败");
    } finally {
      setBusy(false);
    }
  }

  async function startBackfill(mode: "missing" | "failed" | "all" = "missing") {
    setBusy(true);
    try {
      await api("/api/admin/ai/backfills", {
        method: "POST",
        body: JSON.stringify({ mode, maxAttempts: 3 }),
      });
      await refresh();
      setPanel("backfill");
      setPanelOpen(true);
      toast.success("批量分析已开始。");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "批量分析启动失败");
    } finally {
      setBusy(false);
    }
  }

  async function retryBackfill(batchId: string) {
    setBusy(true);
    try {
      await api(`/api/admin/ai/backfills/${encodeURIComponent(batchId)}/retry`, { method: "POST" });
      await refresh();
      toast.success("失败项已重新排队。");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "重试失败");
    } finally {
      setBusy(false);
    }
  }

  async function cancelBackfill(batchId: string) {
    setBusy(true);
    try {
      await api(`/api/admin/ai/backfills/${encodeURIComponent(batchId)}/cancel`, { method: "POST" });
      await refresh();
      toast.success("批量分析已取消。");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "取消失败");
    } finally {
      setBusy(false);
    }
  }

  async function clearGraph() {
    if (!window.confirm("确认清空当前租户的 AI 图谱、模型快照和历史分析结果？LLM 设置会保留，运行中的存量分析会被取消。")) {
      return;
    }
    setBusy(true);
    try {
      const response = await api<{ result: { entities: number; analyses: number; snapshots: number; cancelledBatches: number } }>("/api/admin/ai/graph/clear", { method: "POST" });
      setSelectedEntityId(null);
      await refresh();
      toast.success(`图谱已清空：${response.result.entities} 个实体、${response.result.analyses} 条分析。`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "清空图谱失败");
    } finally {
      setBusy(false);
    }
  }

  const selectedEntity = useMemo(() => overview?.entities.find((entity) => entity.id === selectedEntityId) ?? null, [overview, selectedEntityId]);
  const recentModelingAnalyses = useMemo(() => overview?.analyses.filter((item) => item.status === "completed").slice(0, 8) ?? [], [overview]);
  const activeBatch = overview?.backfills.find((batch) => batch.status === "queued" || batch.status === "running") ?? null;

  function moveWindow(key: FloatingWindowKey, position: FloatingWindowPosition) {
    setFloatingLayout((current) => normalizeFloatingWindowLayout({
      ...current,
      positions: {
        ...current.positions,
        [key]: position,
      },
    }));
  }

  function setWindowMinimized(key: FloatingWindowKey, minimized: boolean) {
    setFloatingLayout((current) => ({
      ...current,
      minimized: {
        ...current.minimized,
        [key]: minimized,
      },
    }));
  }

  function zoomGraph(delta: number) {
    setGraphTransform((current) => ({ ...current, scale: clampNumber(current.scale + delta, 0.45, 2.4) }));
  }

  function resetGraphTransform() {
    setGraphTransform({ x: 0, y: 0, scale: 1 });
  }

  if (loading) {
    return <LoadingBlock title="正在读取 AI 模型" />;
  }

  if (!overview || !form) {
    return <EmptyCard title="暂无 AI 数据" />;
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-slate-100 dark:bg-slate-950">
      <GraphPanel
        overview={overview}
        selectedEntityId={selectedEntityId}
        searchQuery={graphSearch}
        graphTheme={graphTheme}
        transform={graphTransform}
        onTransformChange={setGraphTransform}
        onEntityClick={(entity) => {
          setSelectedEntityId(entity.id);
          setWindowMinimized("entity", false);
        }}
      />

      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        <div className="pointer-events-auto absolute left-3 top-3 flex w-[260px] items-center gap-1.5 rounded-md border border-slate-200 bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/90 dark:shadow-none">
          <SearchIcon className="size-3.5 shrink-0 text-slate-400" />
          <Input
            value={graphSearch}
            onChange={(event) => setGraphSearch(event.target.value)}
            placeholder="搜索节点"
            className="h-6 border-0 bg-transparent px-0 text-xs font-semibold shadow-none focus-visible:ring-0"
          />
          {graphSearch.trim() ? (
            <Button variant="ghost" size="icon" className="size-5 shrink-0" onClick={() => setGraphSearch("")} title="清空搜索">
              <XIcon className="size-3.5" />
            </Button>
          ) : null}
        </div>
        <DraggableWindow
          title="AI 关系图谱"
          subtitle={`${me.currentTenant.name} · 文本分析`}
          icon={BotIcon}
          position={windowPositions.tools}
          minimized={minimizedWindows.tools}
          onPositionChange={(position) => moveWindow("tools", position)}
          onMinimizedChange={(minimized) => setWindowMinimized("tools", minimized)}
        >
          <div className="grid grid-cols-3 gap-1.5">
            <Button variant="outline" size="xs" disabled={busy} onClick={() => void refresh()} title="刷新">
              <RefreshCwIcon data-icon="inline-start" />
              刷新
            </Button>
            <Button variant="outline" size="xs" disabled={busy} onClick={() => void refreshSnapshot()} title="固化快照">
              <GitBranchIcon data-icon="inline-start" />
              快照
            </Button>
            {isAdmin ? (
              <Button size="xs" disabled={busy || Boolean(activeBatch)} onClick={() => void startBackfill("missing")} title="补齐存量">
                <PlayIcon data-icon="inline-start" />
                存量
              </Button>
            ) : null}
            {isAdmin ? (
              <Button className="col-span-3" variant="destructive" size="xs" disabled={busy} onClick={() => void clearGraph()} title="清空图谱">
                <Trash2Icon data-icon="inline-start" />
                清空图谱
              </Button>
            ) : null}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <Button variant="outline" size="xs" onClick={() => zoomGraph(-0.12)} title="缩小图谱">
              <MinusIcon data-icon="inline-start" />
              缩小
            </Button>
            <Button variant="outline" size="xs" onClick={() => zoomGraph(0.12)} title="放大图谱">
              <PlusIcon data-icon="inline-start" />
              放大
            </Button>
            <Button variant="outline" size="xs" onClick={resetGraphTransform} title="重置图谱位置">
              <Maximize2Icon data-icon="inline-start" />
              重置
            </Button>
          </div>
          <GraphLegend />
        </DraggableWindow>

        {panelOpen ? (
          <DraggableWindow
            title="图谱信息"
            subtitle="概览、批次、样本"
            icon={InfoIcon}
            position={windowPositions.panel}
            minimized={minimizedWindows.panel}
            variant="compact"
            bodyClassName="max-h-[min(560px,calc(100vh-220px))] overflow-hidden"
            onPositionChange={(position) => moveWindow("panel", position)}
            onMinimizedChange={(minimized) => setWindowMinimized("panel", minimized)}
          >
            <FloatingPanel
              overview={overview}
              form={form}
              panel={panel}
              busy={busy}
              testing={testing}
              testResult={testResult}
              isAdmin={isAdmin}
              recentAnalyses={recentModelingAnalyses}
              onPanelChange={setPanel}
              onFormChange={setForm}
              onSaveSettings={saveSettings}
              onTestSettings={testSettings}
              onStartBackfill={startBackfill}
              onRetryBackfill={retryBackfill}
              onCancelBackfill={cancelBackfill}
              onAnalyzePost={analyzePost}
              onRefresh={() => void refresh()}
            />
          </DraggableWindow>
        ) : null}

        {selectedEntity ? (
          <DraggableWindow
            title={selectedEntity.name}
            subtitle={entityTypeLabels[selectedEntity.type] ?? selectedEntity.type}
            icon={DatabaseIcon}
            position={windowPositions.entity}
            minimized={minimizedWindows.entity}
            variant="compact"
            bodyClassName="max-h-[min(68vh,680px)] overflow-y-auto"
            onPositionChange={(position) => moveWindow("entity", position)}
            onMinimizedChange={(minimized) => setWindowMinimized("entity", minimized)}
            onClose={() => setSelectedEntityId(null)}
          >
            <EntityDetailPanel entity={selectedEntity} />
          </DraggableWindow>
        ) : null}
      </div>
    </div>
  );
}

function DraggableWindow({
  title,
  subtitle,
  icon: Icon,
  position,
  minimized,
  variant = "default",
  bodyClassName = "",
  children,
  onPositionChange,
  onMinimizedChange,
  onClose,
}: {
  title: string;
  subtitle?: string;
  icon: typeof BotIcon;
  position: FloatingWindowPosition;
  minimized: boolean;
  variant?: "default" | "compact";
  bodyClassName?: string;
  children: React.ReactNode;
  onPositionChange: (position: FloatingWindowPosition) => void;
  onMinimizedChange: (minimized: boolean) => void;
  onClose?: () => void;
}) {
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startRight: number;
    startTop: number;
  } | null>(null);

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRight: position.right,
      startTop: position.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    onPositionChange({
      right: clampNumber(state.startRight - (event.clientX - state.startX), 8, Math.max(8, window.innerWidth - floatingWindowWidth(variant))),
      top: clampNumber(state.startTop + (event.clientY - state.startY), 8, Math.max(8, window.innerHeight - 56)),
    });
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
    }
  }

  function startMouseDrag(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startRight = position.right;
    const startTop = position.top;
    const move = (moveEvent: MouseEvent) => {
      onPositionChange({
        right: clampNumber(startRight - (moveEvent.clientX - startX), 8, Math.max(8, window.innerWidth - floatingWindowWidth(variant))),
        top: clampNumber(startTop + (moveEvent.clientY - startY), 8, Math.max(8, window.innerHeight - 56)),
      });
    };
    const stop = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", stop);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", stop);
  }

  return (
    <section
      className={`pointer-events-auto absolute overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:shadow-none ${variant === "compact" ? "w-[min(300px,calc(100vw-18px))] md:w-[300px]" : "w-[min(340px,calc(100vw-18px))] md:w-[340px]"}`}
      style={{ right: position.right, top: position.top }}
    >
      <div
        className={`flex cursor-grab touch-none items-center gap-2 border-b border-slate-200 active:cursor-grabbing dark:border-slate-700 ${variant === "compact" ? "px-2 py-1" : "px-2 py-1.5"}`}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onMouseDown={startMouseDrag}
      >
        <span className={`flex shrink-0 items-center justify-center rounded-md bg-blue-600 text-white ${variant === "compact" ? "size-6" : "size-7"}`}>
          <Icon className={variant === "compact" ? "size-3" : "size-3.5"} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-black text-slate-950">{title}</div>
          {subtitle ? <div className="truncate text-[10px] font-semibold text-slate-500">{subtitle}</div> : null}
        </div>
        <MoveIcon className="size-3.5 shrink-0 text-slate-400" />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title={minimized ? "展开" : "最小化"}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onMinimizedChange(!minimized);
          }}
        >
          {minimized ? <Maximize2Icon /> : <MinusIcon />}
        </Button>
        {onClose ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title="关闭"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <XIcon />
          </Button>
        ) : null}
      </div>
      {minimized ? null : <div className={`${variant === "compact" ? "p-1.5" : "p-2"} ${bodyClassName}`}>{children}</div>}
    </section>
  );
}

function FloatingPanel({
  overview,
  form,
  panel,
  busy,
  testing,
  testResult,
  isAdmin,
  recentAnalyses,
  onPanelChange,
  onFormChange,
  onSaveSettings,
  onTestSettings,
  onStartBackfill,
  onRetryBackfill,
  onCancelBackfill,
  onAnalyzePost,
  onRefresh,
}: {
  overview: AiOverview;
  form: AiSettingsForm;
  panel: PanelTab;
  busy: boolean;
  testing: boolean;
  testResult: LlmTestResult | null;
  isAdmin: boolean;
  recentAnalyses: AiAnalysisItem[];
  onPanelChange: (panel: PanelTab) => void;
  onFormChange: (form: AiSettingsForm) => void;
  onSaveSettings: () => Promise<void>;
  onTestSettings: () => Promise<void>;
  onStartBackfill: (mode?: "missing" | "failed" | "all") => Promise<void>;
  onRetryBackfill: (batchId: string) => Promise<void>;
  onCancelBackfill: (batchId: string) => Promise<void>;
  onAnalyzePost: (postId: string) => Promise<void>;
  onRefresh: () => void;
}) {
  const tabs: Array<{ key: PanelTab; label: string; icon: typeof BotIcon }> = [
    { key: "overview", label: "概览", icon: ActivityIcon },
    { key: "backfill", label: "批次", icon: Layers3Icon },
    { key: "recent", label: "样本", icon: DatabaseIcon },
  ];
  return (
    <div className="flex max-h-[min(540px,calc(100vh-235px))] min-h-0 flex-col overflow-hidden rounded-md">
      <div className="flex gap-1 border-b border-slate-200 p-1 dark:border-slate-700">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className={`flex h-6 flex-1 items-center justify-center gap-1 rounded-md text-[10px] font-bold transition ${panel === key ? "bg-slate-950 text-white dark:bg-slate-100 dark:text-slate-950" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}
            onClick={() => onPanelChange(key)}
          >
            <Icon className="size-2.5" />
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {panel === "overview" ? <OverviewPanel overview={overview} recentAnalyses={recentAnalyses} /> : null}
        {panel === "backfill" ? (
          <BackfillPanel
            batches={overview.backfills}
            busy={busy}
            isAdmin={isAdmin}
            onStart={onStartBackfill}
            onRetry={onRetryBackfill}
            onCancel={onCancelBackfill}
            onRefresh={onRefresh}
          />
        ) : null}
        {panel === "recent" ? <RecentPanel analyses={overview.analyses} busy={busy} onAnalyze={onAnalyzePost} /> : null}
      </div>
    </div>
  );
}

function OverviewPanel({ overview, recentAnalyses }: { overview: AiOverview; recentAnalyses: AiAnalysisItem[] }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        <Metric icon={DatabaseIcon} label="实体" value={overview.metrics.totalEntities} detail={`${Object.keys(overview.metrics.entityTypeCounts).length} 类实体`} tone="blue" />
        <Metric icon={SparklesIcon} label="样本" value={overview.metrics.analyzedPosts} detail={`${overview.metrics.runningPosts} 个建模中`} tone="green" />
        <Metric icon={Layers3Icon} label="关系" value={overview.graph.stats?.cooccurrenceEdges ?? overview.graph.edges.length} detail={`${overview.graph.stats?.communities ?? 0} 个群组`} tone="amber" />
        <Metric icon={GitBranchIcon} label="话题" value={Object.keys(overview.metrics.categoryCounts).length} detail={`${overview.metrics.failedPosts} 个失败样本`} tone="rose" />
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-black text-slate-950">模型快照</div>
          <Badge variant="secondary">{overview.snapshot ? `v${overview.snapshot.version}` : "未固化"}</Badge>
        </div>
        <p className="mt-1.5 line-clamp-3 text-xs leading-5 text-slate-700">{overview.snapshot?.summary ?? "还没有可用快照。新投稿完成文本建模后会自动沉淀校园实体、话题和关系。"}</p>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <KeyValueGrid values={overview.metrics.entityTypeCounts} labels={entityTypeLabels} />
          <KeyValueGrid values={overview.metrics.categoryCounts} />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs font-black text-slate-950">近期建模样本</div>
        {recentAnalyses.length === 0 ? <EmptyCard title="暂无建模样本" /> : recentAnalyses.map((analysis) => <ModelingSampleRow key={analysis.id} analysis={analysis} />)}
      </div>
    </div>
  );
}

function SettingsPanel({
  overview,
  form,
  busy,
  testing,
  testResult,
  isAdmin,
  onFormChange,
  onSave,
  onTest,
}: {
  overview: AiOverview;
  form: AiSettingsForm;
  busy: boolean;
  testing: boolean;
  testResult: LlmTestResult | null;
  isAdmin: boolean;
  onFormChange: (form: AiSettingsForm) => void;
  onSave: () => Promise<void>;
  onTest: () => Promise<void>;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
        <div>
          <div className="text-xs font-bold text-slate-900">启用 AI 分析</div>
          <div className="text-xs text-slate-500">{form.mode === "llm" ? "LLM + 本地回退" : "本地文本规则"}</div>
        </div>
        <Switch checked={form.enabled} disabled={!isAdmin || busy || testing} onCheckedChange={(enabled) => onFormChange({ ...form, enabled })} />
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <label className="space-y-1 text-[11px] font-bold text-slate-600">
          模式
          <Select value={form.mode} disabled={!isAdmin || busy || testing} onValueChange={(mode) => onFormChange({ ...form, mode: mode as "local" | "llm" })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="local">本地规则</SelectItem>
              <SelectItem value="llm">LLM</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1 text-[11px] font-bold text-slate-600">
          Provider
          <Input value={form.provider} disabled={!isAdmin || busy || testing} onChange={(event) => onFormChange({ ...form, provider: event.target.value })} />
        </label>
        <label className="space-y-1 text-[11px] font-bold text-slate-600 md:col-span-2">
          Base URL
          <Input value={form.baseUrl} disabled={!isAdmin || busy || testing} onChange={(event) => onFormChange({ ...form, baseUrl: event.target.value })} />
        </label>
        <label className="space-y-1 text-[11px] font-bold text-slate-600">
          Model
          <Input value={form.model} disabled={!isAdmin || busy || testing} onChange={(event) => onFormChange({ ...form, model: event.target.value })} />
        </label>
        <label className="space-y-1 text-[11px] font-bold text-slate-600">
          API Key
          <Input type="password" value={form.apiKey} placeholder={overview.settings.apiKeyConfigured ? "保持不变" : "未配置"} disabled={!isAdmin || busy || testing} onChange={(event) => onFormChange({ ...form, apiKey: event.target.value, clearApiKey: false })} />
        </label>
        <label className="space-y-1 text-[11px] font-bold text-slate-600">
          Temperature
          <Input type="number" step="0.1" min={0} max={1} value={form.temperature} disabled={!isAdmin || busy || testing} onChange={(event) => onFormChange({ ...form, temperature: Number(event.target.value) })} />
        </label>
        <label className="space-y-1 text-[11px] font-bold text-slate-600">
          Timeout
          <Input type="number" min={5} max={120} value={form.timeoutSeconds} disabled={!isAdmin || busy || testing} onChange={(event) => onFormChange({ ...form, timeoutSeconds: Number(event.target.value) })} />
        </label>
      </div>

      <div className="grid gap-2">
        <label className="space-y-1 text-[11px] font-bold text-slate-600">
          墙号语气
          <Input value={form.tone} disabled={!isAdmin || busy || testing} onChange={(event) => onFormChange({ ...form, tone: event.target.value })} />
        </label>
        <label className="space-y-1 text-[11px] font-bold text-slate-600">
          允许分类
          <Textarea className="min-h-16" value={form.allowedCategoriesText} disabled={!isAdmin || busy || testing} onChange={(event) => onFormChange({ ...form, allowedCategoriesText: event.target.value })} />
        </label>
        <label className="space-y-1 text-[11px] font-bold text-slate-600">
          建模关键词
          <Textarea className="min-h-16" value={form.modelingKeywordsText} disabled={!isAdmin || busy || testing} onChange={(event) => onFormChange({ ...form, modelingKeywordsText: event.target.value })} />
        </label>
        <label className="space-y-1 text-[11px] font-bold text-slate-600">
          建模备注
          <Input value={form.modelingNotes} disabled={!isAdmin || busy || testing} onChange={(event) => onFormChange({ ...form, modelingNotes: event.target.value })} />
        </label>
      </div>

      {testResult ? (
        <div className={`rounded-md border p-2 text-xs font-semibold leading-5 ${testResult.ok ? "border-green-200 bg-green-50 text-green-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          <div>{testResult.message}</div>
          <div className="mt-1 opacity-80">{testResult.model} · {testResult.latencyMs === null ? "本地模式" : `${testResult.latencyMs}ms`}</div>
        </div>
      ) : null}

      {isAdmin ? (
        <div className="flex flex-wrap justify-end gap-1.5">
          {overview.settings.apiKeyConfigured ? (
            <Button type="button" variant="outline" disabled={busy || testing} onClick={() => onFormChange({ ...form, apiKey: "", clearApiKey: true })}>
              <KeyRoundIcon data-icon="inline-start" />
              清除 Key
            </Button>
          ) : null}
          <Button type="button" variant="outline" disabled={busy || testing} onClick={() => void onTest()}>
            <TestTube2Icon data-icon="inline-start" />
            {testing ? "测试中" : "测试连接"}
          </Button>
          <Button type="button" disabled={busy || testing} onClick={() => void onSave()}>
            <SaveIcon data-icon="inline-start" />
            保存
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function BackfillPanel({
  batches,
  busy,
  isAdmin,
  onStart,
  onRetry,
  onCancel,
  onRefresh,
}: {
  batches: AiBackfillBatch[];
  busy: boolean;
  isAdmin: boolean;
  onStart: (mode?: "missing" | "failed" | "all") => Promise<void>;
  onRetry: (batchId: string) => Promise<void>;
  onCancel: (batchId: string) => Promise<void>;
  onRefresh: () => void;
}) {
  const latest = batches[0] ?? null;
  const active = latest && (latest.status === "queued" || latest.status === "running") ? latest : null;
  const progress = latest && latest.totalCount > 0 ? Math.round(((latest.succeededCount + latest.skippedCount + latest.failedCount) / latest.totalCount) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div>
          <div className="text-xs font-black text-slate-950">存量分析</div>
          <div className="text-xs font-semibold text-slate-500">{latest ? `${backfillStatusLabels[latest.status] ?? latest.status} · ${latest.succeededCount + latest.skippedCount + latest.failedCount}/${latest.totalCount}` : "暂无批次"}</div>
        </div>
        <Button variant="outline" size="xs" disabled={busy} onClick={onRefresh}>
          <RefreshCwIcon data-icon="inline-start" />
          刷新状态
        </Button>
      </div>

      {isAdmin ? (
        <div className="flex flex-wrap gap-1.5">
          {active ? (
            <Button variant="outline" size="xs" disabled={busy} onClick={() => void onCancel(active.id)}>
              <StopCircleIcon data-icon="inline-start" />
              停止
            </Button>
          ) : null}
          {latest?.failedCount ? (
            <Button variant="outline" size="xs" disabled={busy || Boolean(active)} onClick={() => void onRetry(latest.id)}>
              <RotateCcwIcon data-icon="inline-start" />
              重试失败
            </Button>
          ) : null}
          <Button size="xs" disabled={busy || Boolean(active)} onClick={() => void onStart("missing")}>
            <PlayIcon data-icon="inline-start" />
            补齐未分析
          </Button>
        </div>
      ) : null}

      {latest ? (
        <div className="space-y-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-blue-600" style={{ width: `${progress}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-xs">
            <BackfillCount label="队列" value={latest.queuedCount} />
            <BackfillCount label="运行" value={latest.runningCount} />
            <BackfillCount label="成功" value={latest.succeededCount} />
            <BackfillCount label="跳过" value={latest.skippedCount} />
            <BackfillCount label="失败" value={latest.failedCount} />
            <BackfillCount label="重试" value={latest.maxAttempts} />
          </div>
          {latest.lastError ? <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs font-semibold leading-5 text-rose-700">{latest.lastError}</div> : null}
          <div className="space-y-1.5">
            {latest.logs.length === 0 ? <EmptyCard title="暂无日志" /> : latest.logs.slice(0, 12).map((log) => (
              <div key={log.id} className="flex gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                <span className={`mt-1 size-2 shrink-0 rounded-full ${log.level === "error" ? "bg-rose-500" : log.level === "warn" ? "bg-amber-500" : "bg-blue-500"}`} />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-800">{log.message}</div>
                  <div className="mt-0.5 text-xs font-medium text-slate-500">{formatTime(log.createdAt)} · {log.event}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyCard title="暂无批量分析记录" />
      )}
    </div>
  );
}

function GraphPanel({
  overview,
  selectedEntityId,
  searchQuery,
  graphTheme,
  transform,
  onTransformChange,
  onEntityClick,
}: {
  overview: AiOverview;
  selectedEntityId: string | null;
  searchQuery: string;
  graphTheme: GraphColorTheme;
  transform: GraphTransform;
  onTransformChange: (transform: GraphTransform) => void;
  onEntityClick: (entity: AiEntity) => void;
}) {
  const panStateRef = useRef<{ pointerId: number; startX: number; startY: number; graphX: number; graphY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const nodeDragStateRef = useRef<{
    pointerId: number;
    nodeId: string;
    startGraphX: number;
    startGraphY: number;
    startNodeX: number;
    startNodeY: number;
    moved: boolean;
  } | null>(null);
  const fixedNodePositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const [graphSize, setGraphSize] = useState<GraphSize>({ width: 1200, height: 760 });
  const entityByNodeId = useMemo(() => new Map(overview.entities.map((entity) => [`entity:${entity.id}`, entity])), [overview.entities]);
  const nodes = useMemo(() => overview.graph.nodes.slice(0, 180), [overview.graph.nodes]);
  const normalizedSearch = normalizeSearchTerm(searchQuery);
  const matchedNodeIds = useMemo(() => {
    if (!normalizedSearch) return new Set<string>();
    return new Set(nodes
      .filter((node) => graphNodeSearchText(node, entityByNodeId.get(node.id)).includes(normalizedSearch))
      .map((node) => node.id));
  }, [entityByNodeId, nodes, normalizedSearch]);
  const searchActive = Boolean(normalizedSearch);
  const edges = useMemo(() => {
    const nodeIds = new Set(nodes.map((node) => node.id));
    return overview.graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)).slice(0, 280);
  }, [nodes, overview.graph.edges]);
  const graphBounds = useMemo(() => createGraphBounds(graphSize, nodes.length), [graphSize, nodes.length]);
  const positioned = useOrganicGraphLayout(nodes, edges, graphBounds, fixedNodePositionsRef);
  const byId = new Map(positioned.map((node) => [node.id, node]));

  useEffect(() => {
    const nodeIds = new Set(nodes.map((node) => node.id));
    fixedNodePositionsRef.current = Object.fromEntries(Object.entries(fixedNodePositionsRef.current).filter(([nodeId]) => nodeIds.has(nodeId)));
  }, [nodes]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setGraphSize({
        width: Math.max(640, Math.round(rect.width)),
        height: Math.max(520, Math.round(rect.height)),
      });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function startPan(event: React.PointerEvent<SVGSVGElement>) {
    const target = event.target instanceof Element ? event.target : null;
    if (event.button !== 0 || target?.closest('[role="button"]')) {
      return;
    }
    panStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      graphX: transform.x,
      graphY: transform.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePan(event: React.PointerEvent<SVGSVGElement>) {
    const state = panStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    onTransformChange({
      ...transform,
      x: state.graphX + event.clientX - state.startX,
      y: state.graphY + event.clientY - state.startY,
    });
  }

  function endPan(event: React.PointerEvent<SVGSVGElement>) {
    if (panStateRef.current?.pointerId === event.pointerId) {
      panStateRef.current = null;
    }
  }

  function zoomWithWheel(event: React.WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const nextScale = clampNumber(transform.scale * (event.deltaY < 0 ? 1.08 : 0.92), 0.45, 2.4);
    if (nextScale === transform.scale) return;
    const svgPoint = clientToSvgPoint(event.clientX, event.clientY);
    if (!svgPoint) {
      onTransformChange({ ...transform, scale: nextScale });
      return;
    }
    const graphPoint = {
      x: (svgPoint.x - transform.x) / transform.scale,
      y: (svgPoint.y - transform.y) / transform.scale,
    };
    onTransformChange({
      ...transform,
      scale: nextScale,
      x: svgPoint.x - graphPoint.x * nextScale,
      y: svgPoint.y - graphPoint.y * nextScale,
    });
  }

  function startNodeDrag(event: React.PointerEvent<SVGGElement>, node: PositionedGraphNode) {
    if (event.button !== 0 || node.kind !== "entity") return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointerToGraphPoint(event);
    if (!point) return;
    nodeDragStateRef.current = {
      pointerId: event.pointerId,
      nodeId: node.id,
      startGraphX: point.x,
      startGraphY: point.y,
      startNodeX: node.x,
      startNodeY: node.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveNodeDrag(event: React.PointerEvent<SVGGElement>) {
    const state = nodeDragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointerToGraphPoint(event);
    if (!point) return;
    const x = state.startNodeX + point.x - state.startGraphX;
    const y = state.startNodeY + point.y - state.startGraphY;
    state.moved = state.moved || Math.hypot(x - state.startNodeX, y - state.startNodeY) > 4;
    fixedNodePositionsRef.current = {
      ...fixedNodePositionsRef.current,
      [state.nodeId]: { x, y },
    };
  }

  function endNodeDrag(event: React.PointerEvent<SVGGElement>, entity: AiEntity) {
    const state = nodeDragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    nodeDragStateRef.current = null;
    if (!state.moved) {
      onEntityClick(entity);
    }
  }

  function pointerToGraphPoint(event: React.PointerEvent<SVGElement>) {
    const svgPoint = clientToSvgPoint(event.clientX, event.clientY);
    if (!svgPoint) return null;
    return {
      x: (svgPoint.x - transform.x) / transform.scale,
      y: (svgPoint.y - transform.y) / transform.scale,
    };
  }

  function clientToSvgPoint(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const viewBox = svg.viewBox.baseVal;
    const viewBoxWidth = viewBox.width || graphSize.width;
    const viewBoxHeight = viewBox.height || graphSize.height;
    return {
      x: viewBox.x + ((clientX - rect.left) / rect.width) * viewBoxWidth,
      y: viewBox.y + ((clientY - rect.top) / rect.height) * viewBoxHeight,
    };
  }

  if (nodes.length <= 1) {
    return (
      <div className="flex h-full min-h-[calc(100vh-72px)] items-center justify-center">
        <EmptyCard title="暂无图谱节点" />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full min-h-[calc(100vh-72px)] w-full overflow-hidden"
      style={{
        backgroundColor: graphTheme.surface,
        backgroundImage: `linear-gradient(${graphTheme.grid} 1px, transparent 1px), linear-gradient(90deg, ${graphTheme.grid} 1px, transparent 1px)`,
        backgroundSize: "42px 42px",
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${graphSize.width} ${graphSize.height}`}
        className="h-full min-h-[calc(100vh-72px)] w-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onWheel={zoomWithWheel}
      >
        <rect width={graphSize.width} height={graphSize.height} fill="transparent" />
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
          {edges.map((edge, index) => {
            const source = byId.get(edge.source);
            const target = byId.get(edge.target);
            if (!source || !target) return null;
            const searchRelated = !searchActive || matchedNodeIds.has(edge.source) || matchedNodeIds.has(edge.target);
            const relationLabel = edgeLabelText(edge);
            const relationLabelX = (source.x + target.x) / 2;
            const relationLabelY = (source.y + target.y) / 2 - 5;
            const relationLabelWidth = relationLabel ? edgeLabelWidth(relationLabel) : 0;
            return (
              <g key={`${edge.source}-${edge.target}-${index}`}>
                <path
                  d={edgePath(source, target)}
                  fill="none"
                  stroke={edgeStroke(edge.type, graphTheme)}
                  strokeDasharray={edgeDash(edge.type)}
                  strokeLinecap="round"
                  strokeOpacity={(edge.type === "CO_OCCURS" ? 0.5 : 0.32) * (searchRelated ? 1 : 0.18)}
                  strokeWidth={edgeWidth(edge)}
                />
                {relationLabel && searchRelated ? (
                  <g className="pointer-events-none select-none" opacity={searchActive ? 0.95 : 1}>
                    <rect
                      x={relationLabelX - relationLabelWidth / 2}
                      y={relationLabelY - 8}
                      width={relationLabelWidth}
                      height={16}
                      rx={4}
                      fill={graphTheme.labelBg}
                      fillOpacity={0.92}
                      stroke={edgeStroke(edge.type, graphTheme)}
                      strokeOpacity={0.22}
                    />
                    <text
                      x={relationLabelX}
                      y={relationLabelY + 4}
                      textAnchor="middle"
                      className="text-[9px] font-bold"
                      fill={graphTheme.labelText}
                    >
                      {shortLabel(relationLabel, 14)}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}
          {positioned.map((node) => {
            const entity = entityByNodeId.get(node.id);
            const selected = entity?.id === selectedEntityId;
            const searchMatched = matchedNodeIds.has(node.id);
            const nodeOpacity = searchActive && !searchMatched ? 0.28 : 1;
            const labelLength = node.kind === "tenant" ? 16 : 12;
            if (entity) {
              return (
                <g
                  key={node.id}
                  role="button"
                  aria-label={`${entity.name} 详情`}
                  tabIndex={0}
                  className="cursor-grab outline-none active:cursor-grabbing"
                  onPointerDown={(event) => startNodeDrag(event, node)}
                  onPointerMove={moveNodeDrag}
                  onPointerUp={(event) => endNodeDrag(event, entity)}
                  onPointerCancel={(event) => {
                    event.stopPropagation();
                    nodeDragStateRef.current = null;
                  }}
                  opacity={nodeOpacity}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onEntityClick(entity);
                    }
                  }}
                >
                  {searchMatched ? (
                    <circle cx={node.x} cy={node.y} r={node.r + 12} fill={graphTheme.searchFill} stroke={graphTheme.searchStroke} strokeWidth="2.5" opacity="0.82" />
                  ) : null}
                  <circle cx={node.x} cy={node.y} r={node.r + (selected ? 8 : 0)} fill={selected ? graphTheme.selectedHalo : graphTheme.nodeHalo} opacity={selected ? "0.18" : "0.82"} />
                  <circle cx={node.x} cy={node.y} r={node.r} fill={nodeFillForNode(node, graphTheme)} stroke={selected ? graphTheme.selectedStroke : graphTheme.nodeStroke} strokeWidth={selected ? 5 : 3} />
                  <text x={node.x} y={node.y + node.r + 18} textAnchor="middle" className="pointer-events-none select-none text-[13px] font-bold" fill={graphTheme.labelText} stroke={graphTheme.labelStroke} strokeWidth="4" paintOrder="stroke">
                    {shortLabel(node.label, labelLength)}
                  </text>
                  <text x={node.x} y={node.y + 4} textAnchor="middle" className="pointer-events-none select-none fill-white text-[11px] font-black">
                    {entityTypeLabels[entity.type]?.slice(0, 2) ?? "实体"}
                  </text>
                </g>
              );
            }
            return (
              <g key={node.id} opacity={nodeOpacity}>
                {searchMatched ? (
                  <circle cx={node.x} cy={node.y} r={node.r + 10} fill={graphTheme.searchFill} stroke={graphTheme.searchStroke} strokeWidth="2.5" opacity="0.82" />
                ) : null}
                <circle cx={node.x} cy={node.y} r={node.r} fill={nodeFillForNode(node, graphTheme)} stroke={graphTheme.nodeStroke} strokeWidth="3" />
                <text x={node.x} y={node.y + node.r + 18} textAnchor="middle" className="pointer-events-none select-none text-[13px] font-bold" fill={graphTheme.labelText} stroke={graphTheme.labelStroke} strokeWidth="4" paintOrder="stroke">
                  {shortLabel(node.label, labelLength)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function EntityDetailPanel({ entity }: { entity: AiEntity }) {
  const aliases = toStrings(entity.aliases);
  const evidence = toEvidence(entity.evidence);
  return (
    <div className="overflow-hidden text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-slate-950" title={entity.name}>{entity.name}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge variant="secondary">{entityTypeLabels[entity.type] ?? entity.type}</Badge>
            <Badge variant="outline">{Math.round(entity.confidence * 100)}%</Badge>
          </div>
        </div>
      </div>
      <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
        <CompactDetailLine label="来源" value={entity.source} />
        <CompactDetailLine label="最近" value={formatTime(entity.lastSeenAt)} />
        <CompactDetailLine label="首次" value={formatTime(entity.firstSeenAt)} />
        <CompactDetailLine label="更新" value={formatTime(entity.updatedAt)} />
      </div>
      {aliases.length > 0 ? (
        <div className="mt-2">
          <div className="text-xs font-black text-slate-500">别名</div>
          <div className="mt-1.5 flex flex-wrap gap-1">{aliases.map((alias) => <Badge key={alias} variant="outline">{alias}</Badge>)}</div>
        </div>
      ) : null}
      <div className="mt-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-black text-slate-500">原稿件</div>
          <Badge variant="outline">{evidence.filter((item) => item.post).length}/{evidence.length}</Badge>
        </div>
        <div className="mt-1.5 space-y-1.5">
          {evidence.length === 0 ? <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500">暂无证据片段</div> : evidence.slice().reverse().map((item, index) => (
            <EvidencePostCard key={`${item.postId ?? index}-${item.seenAt ?? index}`} evidence={item} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CompactDetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 py-0.5">
      <span className="shrink-0 text-[11px] font-black text-slate-500">{label}</span>
      <span className="truncate text-xs font-bold text-slate-900" title={value}>{value}</span>
    </div>
  );
}

function EvidencePostCard({ evidence }: { evidence: AiEntityEvidence }) {
  const post = evidence.post;
  const attachments = countArray(post?.attachments);
  if (!post) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
        <div className="text-xs font-semibold leading-5 text-slate-800">{evidence.text || "未记录文本"}</div>
        <div className="mt-1 text-xs font-medium text-slate-500">{evidence.seenAt ? formatTime(evidence.seenAt) : "未知时间"}{evidence.postId ? ` · ${shortLabel(evidence.postId, 10)}` : ""}</div>
      </div>
    );
  }
  return (
    <article className="rounded-md border border-slate-200 bg-slate-50 p-2">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1">
          <span className="text-xs font-black text-slate-950">#{post.displayId}</span>
          <Badge variant="outline">{statusLabels[post.status] ?? post.status}</Badge>
          {post.anonymous ? <Badge variant="secondary">匿名</Badge> : null}
        </div>
        <span className="text-[11px] font-semibold text-slate-500">{formatDateTimeWithYear(post.createdAt)}</span>
      </div>
      <div className="mt-1.5 rounded-md border border-slate-200 bg-white px-2 py-1">
        <CompactDetailLine label="作者" value={post.anonymous ? "匿名投稿" : post.author.displayName || post.author.email || post.author.qqUin} />
        <CompactDetailLine label="附件" value={`${attachments} 个`} />
        <CompactDetailLine label="ID" value={shortLabel(post.id, 12)} />
        <CompactDetailLine label="更新" value={formatDateTimeWithYear(post.updatedAt)} />
      </div>
      {(post.legacyTenantSlug || post.legacyDisplayId || post.legacyUuid) ? (
        <div className="mt-1.5 truncate rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-500" title={[post.legacyTenantSlug, post.legacyDisplayId ? `#${post.legacyDisplayId}` : null, post.legacyUuid].filter(Boolean).join(" · ")}>
          历史来源：{[post.legacyTenantSlug, post.legacyDisplayId ? `#${post.legacyDisplayId}` : null, post.legacyUuid ? shortLabel(post.legacyUuid, 12) : null].filter(Boolean).join(" · ")}
        </div>
      ) : null}
      <div className="mt-1.5 rounded-md border border-slate-200 bg-white p-2">
        <div className="text-xs font-black text-slate-500">完整正文</div>
        <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-800">{post.text || "空文本"}</p>
      </div>
      <div className="mt-1.5 rounded-md border border-blue-100 bg-blue-50 p-2">
        <div className="text-xs font-black text-blue-700">命中片段</div>
        <div className="mt-1 text-xs font-semibold leading-5 text-blue-800">{evidence.text || "未记录片段"}</div>
        <div className="mt-1 truncate text-[11px] font-medium text-blue-700/75">{evidence.seenAt ? formatDateTimeWithYear(evidence.seenAt) : "未知时间"}{evidence.analysisId ? ` · ${shortLabel(evidence.analysisId, 10)}` : ""}</div>
      </div>
    </article>
  );
}

function RecentPanel({ analyses, busy, onAnalyze }: { analyses: AiAnalysisItem[]; busy: boolean; onAnalyze: (postId: string) => Promise<void> }) {
  return (
    <div className="space-y-2">
      {analyses.length === 0 ? <EmptyCard title="暂无分析结果" /> : analyses.slice(0, 16).map((analysis) => (
        <AnalysisRow key={analysis.id} analysis={analysis} busy={busy} onAnalyze={onAnalyze} />
      ))}
    </div>
  );
}

function GraphLegend() {
  const items: Array<[string, string]> = [
    ["租户", "tenant"],
    ["类型", "type"],
    ["实体", "entity"],
    ["话题", "category"],
  ];
  return (
    <div className="mt-2 hidden rounded-md border border-slate-200 bg-slate-50/90 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800/70 md:block">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {items.map(([label, kind]) => (
          <div key={kind} className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: nodeFill(kind) }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, detail, tone }: { icon: typeof BotIcon; label: string; value: number; detail: string; tone: "blue" | "green" | "amber" | "rose" }) {
  const toneClass = {
    blue: "product-accent-blue",
    green: "product-accent-green",
    amber: "product-accent-amber",
    rose: "product-accent-rose",
  }[tone];
  return (
    <div className={`rounded-md border p-2 ${toneClass}`}>
      <div className="flex items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/70 dark:bg-slate-950/50">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-bold opacity-80">{label}</div>
          <div className="mt-0.5 text-base font-black leading-none">{value}</div>
        </div>
      </div>
      <div className="mt-1.5 truncate text-[11px] font-semibold opacity-80">{detail}</div>
    </div>
  );
}

function BackfillCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
      <div className="font-bold text-slate-500">{label}</div>
      <div className="mt-0.5 text-base font-black text-slate-950">{value}</div>
    </div>
  );
}

function AnalysisRow({ analysis, busy, onAnalyze }: { analysis: AiAnalysisItem; busy: boolean; onAnalyze: (postId: string) => Promise<void> }) {
  const categories = toStrings(analysis.categories);
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-black text-slate-950">#{analysis.displayId}</span>
            <Badge variant="outline">{statusLabels[analysis.postStatus] ?? analysis.postStatus}</Badge>
            <Badge variant="secondary">{analysis.provider}</Badge>
            {categories.slice(0, 2).map((category) => <Badge key={category} variant="outline">{category}</Badge>)}
          </div>
          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-700">{analysis.postText}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-slate-500">
            {toStrings(analysis.reasons).slice(0, 3).map((reason) => <span key={reason}>{reason}</span>)}
          </div>
        </div>
        <Button variant="outline" size="xs" disabled={busy} onClick={() => void onAnalyze(analysis.postId)}>
          <RefreshCwIcon data-icon="inline-start" />
          重跑
        </Button>
      </div>
    </div>
  );
}

function ModelingSampleRow({ analysis }: { analysis: AiAnalysisItem }) {
  const categories = toStrings(analysis.categories);
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-slate-900">#{analysis.displayId}</span>
          {categories.slice(0, 2).map((category) => <Badge key={category} variant="outline">{category}</Badge>)}
        </div>
        <span className="text-xs font-semibold text-slate-500">{formatTime(analysis.updatedAt)}</span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-700">{analysis.postText}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {toStrings(analysis.reasons).slice(0, 3).map((reason) => <span key={reason} className="text-xs font-medium text-slate-500">{reason}</span>)}
      </div>
    </div>
  );
}

function KeyValueGrid({ values, labels = {} }: { values: Record<string, number>; labels?: Record<string, string> }) {
  const entries = Object.entries(values).sort((left, right) => right[1] - left[1]).slice(0, 6);
  if (entries.length === 0) return <div className="rounded-md border border-slate-200 bg-white p-2 text-xs font-semibold text-slate-500">暂无数据</div>;
  return (
    <>
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
          <div className="truncate text-xs font-bold text-slate-500">{labels[key] ?? key}</div>
          <div className="mt-0.5 text-base font-black text-slate-950">{value}</div>
        </div>
      ))}
    </>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-xs font-black text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-bold text-slate-900" title={value}>{value}</div>
    </div>
  );
}

function toForm(settings: TenantAiSettings): AiSettingsForm {
  return {
    enabled: settings.enabled,
    mode: settings.mode,
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: "",
    clearApiKey: false,
    temperature: settings.temperature,
    timeoutSeconds: settings.timeoutSeconds,
    tone: settings.rules.tone ?? "",
    strictPrivacy: settings.rules.strictPrivacy ?? true,
    allowedCategoriesText: (settings.rules.allowedCategories ?? []).join("\n"),
    modelingKeywordsText: (settings.rules.modelingKeywords ?? []).join("\n"),
    modelingNotes: settings.rules.modelingNotes ?? "",
  };
}

function lines(value: string) {
  return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function toStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toEvidence(value: unknown): AiEntityEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.map((item): AiEntityEvidence | null => {
    if (typeof item === "string") {
      return { text: item, postId: null, analysisId: null, seenAt: null, post: null };
    }
    if (!item || typeof item !== "object") {
      return null;
    }
    const record = item as Record<string, unknown>;
    return {
      text: typeof record.text === "string" ? record.text : "",
      postId: typeof record.postId === "string" ? record.postId : null,
      analysisId: typeof record.analysisId === "string" ? record.analysisId : null,
      seenAt: typeof record.seenAt === "string" ? record.seenAt : null,
      post: normalizeEvidencePost(record.post),
    };
  }).filter((item): item is AiEntityEvidence => Boolean(item));
}

function normalizeEvidencePost(value: unknown): AiEntityEvidence["post"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const author = record.author && typeof record.author === "object" && !Array.isArray(record.author) ? record.author as Record<string, unknown> : {};
  return {
    id: typeof record.id === "string" ? record.id : "",
    displayId: typeof record.displayId === "number" ? record.displayId : 0,
    legacyTenantSlug: typeof record.legacyTenantSlug === "string" ? record.legacyTenantSlug : null,
    legacyDisplayId: typeof record.legacyDisplayId === "number" ? record.legacyDisplayId : null,
    legacyUuid: typeof record.legacyUuid === "string" ? record.legacyUuid : null,
    text: typeof record.text === "string" ? record.text : "",
    attachments: record.attachments,
    anonymous: Boolean(record.anonymous),
    status: typeof record.status === "string" ? record.status : "unknown",
    recallIgnored: Boolean(record.recallIgnored),
    recallIgnoredAt: typeof record.recallIgnoredAt === "string" ? record.recallIgnoredAt : null,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
    author: {
      id: typeof author.id === "string" ? author.id : "",
      qqUin: typeof author.qqUin === "string" ? author.qqUin : "",
      displayName: typeof author.displayName === "string" ? author.displayName : null,
      email: typeof author.email === "string" ? author.email : null,
    },
  };
}

function countArray(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function floatingWindowStorageKey(tenantId: string) {
  return `${floatingWindowStoragePrefix}:${tenantId}`;
}

function readFloatingWindowLayout(tenantId: string): FloatingWindowLayout {
  if (typeof window === "undefined") {
    return floatingWindowDefaults;
  }
  try {
    const raw = window.localStorage.getItem(floatingWindowStorageKey(tenantId));
    if (!raw) {
      return normalizeFloatingWindowLayout(floatingWindowDefaults);
    }
    const parsed = JSON.parse(raw) as Partial<FloatingWindowLayout>;
    return normalizeFloatingWindowLayout({
      positions: {
        ...floatingWindowDefaults.positions,
        ...parsed.positions,
      },
      minimized: {
        ...floatingWindowDefaults.minimized,
        ...parsed.minimized,
      },
    });
  } catch {
    return normalizeFloatingWindowLayout(floatingWindowDefaults);
  }
}

function writeFloatingWindowLayout(tenantId: string, layout: FloatingWindowLayout) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(floatingWindowStorageKey(tenantId), JSON.stringify(normalizeFloatingWindowLayout(layout)));
  } catch {
    // Ignore localStorage failures; the draggable windows still work for the current session.
  }
}

function normalizeFloatingWindowLayout(layout: FloatingWindowLayout): FloatingWindowLayout {
  return {
    positions: {
      tools: normalizeFloatingWindowPosition("tools", layout.positions.tools),
      panel: normalizeFloatingWindowPosition("panel", layout.positions.panel),
      entity: normalizeFloatingWindowPosition("entity", layout.positions.entity),
    },
    minimized: {
      tools: Boolean(layout.minimized.tools),
      panel: Boolean(layout.minimized.panel),
      entity: Boolean(layout.minimized.entity),
    },
  };
}

function normalizeFloatingWindowPosition(key: FloatingWindowKey, position?: Partial<FloatingWindowPosition>) {
  if (typeof window === "undefined") {
    return floatingWindowDefaults.positions[key];
  }
  const width = floatingWindowWidthForKey(key);
  const maxRight = Math.max(8, window.innerWidth - width);
  const maxTop = Math.max(8, window.innerHeight - 56);
  const right = Number.isFinite(position?.right) ? Number(position?.right) : floatingWindowDefaults.positions[key].right;
  const top = Number.isFinite(position?.top) ? Number(position?.top) : floatingWindowDefaults.positions[key].top;
  return {
    right: clampNumber(right, 8, maxRight),
    top: clampNumber(top, 8, maxTop),
  };
}

function floatingWindowWidth(variant: "default" | "compact") {
  return variant === "compact" ? 300 : 340;
}

function floatingWindowWidthForKey(key: FloatingWindowKey) {
  return key === "panel" ? 300 : 340;
}

type AiGraphNode = AiOverview["graph"]["nodes"][number];
type AiGraphEdge = AiOverview["graph"]["edges"][number];
type PositionedGraphNode = AiGraphNode & { x: number; y: number; r: number };

function createGraphBounds(size: GraphSize, nodeCount: number): GraphBounds {
  const centerX = size.width / 2;
  const centerY = size.height / 2;
  const densityFactor = Math.max(2.8, Math.min(5.2, 2.2 + Math.sqrt(Math.max(1, nodeCount)) * 0.22));
  const width = Math.max(2400, size.width * densityFactor);
  const height = Math.max(1800, size.height * densityFactor);
  return {
    width,
    height,
    minX: centerX - width / 2,
    maxX: centerX + width / 2,
    minY: centerY - height / 2,
    maxY: centerY + height / 2,
    centerX,
    centerY,
  };
}

function normalizeSearchTerm(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function graphNodeSearchText(node: AiGraphNode, entity?: AiEntity) {
  return normalizeSearchTerm([
    node.label,
    node.kind,
    node.entityType ? entityTypeLabels[node.entityType] ?? node.entityType : "",
    entity?.name,
    entity?.type ? entityTypeLabels[entity.type] ?? entity.type : "",
    ...toStrings(entity?.aliases),
  ].filter(Boolean).join(" "));
}

function useOrganicGraphLayout(
  nodes: AiGraphNode[],
  edges: AiGraphEdge[],
  bounds: GraphBounds,
  fixedPositionsRef: React.MutableRefObject<Record<string, { x: number; y: number }>>,
) {
  const [positioned, setPositioned] = useState<PositionedGraphNode[]>([]);
  const positionsRef = useRef<Map<string, PositionedGraphNode>>(new Map());
  const velocitiesRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    const previous = positionsRef.current;
    const seeded = layoutGraph(nodes, edges, bounds, previous);
    positionsRef.current = new Map(seeded.map((node) => [node.id, node]));
    velocitiesRef.current = new Map(seeded.map((node) => [node.id, velocitiesRef.current.get(node.id) ?? { x: 0, y: 0 }]));
    setPositioned(seeded);
  }, [nodes, edges, bounds.width, bounds.height, bounds.centerX, bounds.centerY]);

  useEffect(() => {
    let frame = 0;
    let active = true;
    const tick = () => {
      if (!active) return;
      stepOrganicGraph(positionsRef.current, velocitiesRef.current, edges, bounds, fixedPositionsRef.current);
      setPositioned([...positionsRef.current.values()].map((node) => ({ ...node })));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, [edges, bounds.width, bounds.height, bounds.centerX, bounds.centerY, fixedPositionsRef]);

  return positioned;
}

function stepOrganicGraph(
  positions: Map<string, PositionedGraphNode>,
  velocities: Map<string, { x: number; y: number }>,
  edges: AiGraphEdge[],
  bounds: GraphBounds,
  fixedPositions: Record<string, { x: number; y: number }>,
) {
  const nodes = [...positions.values()];
  const repulsion = Math.max(7600, Math.min(18000, bounds.width * bounds.height * 0.0022));
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex]!;
      const dx = right.x - left.x || 0.01;
      const dy = right.y - left.y || 0.01;
      const distance = Math.max(left.r + right.r + 4, Math.hypot(dx, dy));
      const kindFactor = left.kind === "entity" && right.kind === "entity" ? 1 : 0.64;
      const force = Math.min(8, repulsion * kindFactor / (distance * distance));
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      pushVelocity(velocities, fixedPositions, left.id, -fx, -fy);
      pushVelocity(velocities, fixedPositions, right.id, fx, fy);
    }
  }

  for (const edge of edges) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) continue;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const desired = edgeIdealDistance(edge);
    const force = (distance - desired) * edgeSpringStrength(edge);
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    pushVelocity(velocities, fixedPositions, source.id, fx, fy);
    pushVelocity(velocities, fixedPositions, target.id, -fx, -fy);
  }

  for (const node of nodes) {
    const fixed = fixedPositions[node.id];
    if (fixed) {
      node.x = fixed.x;
      node.y = fixed.y;
      velocities.set(node.id, { x: 0, y: 0 });
      continue;
    }
    const anchor = graphAnchor(node, bounds);
    const pull = node.kind === "tenant" ? 0.06 : node.kind === "type" || node.kind === "category" ? 0.012 : 0.0018;
    const velocity = velocities.get(node.id) ?? { x: 0, y: 0 };
    velocity.x += (anchor.x - node.x) * pull;
    velocity.y += (anchor.y - node.y) * pull;
    applySoftBounds(node, velocity, bounds);
    velocity.x *= 0.82;
    velocity.y *= 0.82;
    node.x += velocity.x;
    node.y += velocity.y;
    velocities.set(node.id, velocity);
  }
}

function pushVelocity(velocities: Map<string, { x: number; y: number }>, fixed: Record<string, { x: number; y: number }>, nodeId: string, x: number, y: number) {
  if (fixed[nodeId]) return;
  const velocity = velocities.get(nodeId) ?? { x: 0, y: 0 };
  velocity.x += x;
  velocity.y += y;
  velocities.set(nodeId, velocity);
}

function applySoftBounds(node: PositionedGraphNode, velocity: { x: number; y: number }, bounds: GraphBounds) {
  const margin = Math.max(42, node.r + 14);
  if (node.x < bounds.minX + margin) velocity.x += (bounds.minX + margin - node.x) * 0.018;
  if (node.x > bounds.maxX - margin) velocity.x -= (node.x - (bounds.maxX - margin)) * 0.018;
  if (node.y < bounds.minY + margin) velocity.y += (bounds.minY + margin - node.y) * 0.018;
  if (node.y > bounds.maxY - margin) velocity.y -= (node.y - (bounds.maxY - margin)) * 0.018;
}

function graphAnchor(node: PositionedGraphNode, bounds: GraphBounds) {
  const { centerX, centerY } = bounds;
  if (node.kind === "tenant") {
    return { x: centerX, y: centerY };
  }
  if (node.kind === "type" || node.kind === "category") {
    const jitter = deterministicJitter(node.id);
    const angle = Math.atan2(jitter.y || 0.2, jitter.x || 0.8);
    const radius = Math.min(bounds.width, bounds.height) * (node.kind === "type" ? 0.11 : 0.17);
    return {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    };
  }
  return { x: centerX, y: centerY };
}

function layoutGraph(nodes: AiGraphNode[], edges: AiGraphEdge[], bounds: GraphBounds, previousPositions?: Map<string, PositionedGraphNode>): PositionedGraphNode[] {
  const { centerX, centerY } = bounds;
  const entityNodes = nodes.filter((node) => node.kind === "entity");
  const hubNodes = nodes.filter((node) => node.kind !== "entity" && node.kind !== "tenant");
  const communities = [...new Set(entityNodes.map((node) => node.community ?? node.entityType ?? "entity"))];
  const communityCenters = new Map<string, { x: number; y: number }>();

  communities.forEach((community, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, communities.length) - Math.PI / 2;
    const radiusX = Math.min(bounds.width * 0.32, Math.max(430, bounds.width * 0.18));
    const radiusY = Math.min(bounds.height * 0.3, Math.max(310, bounds.height * 0.16));
    communityCenters.set(community, {
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
    });
  });

  const positioned: PositionedGraphNode[] = nodes.map((node, index) => {
    const r = node.radius ?? Math.max(10, Math.min(30, 8 + Math.sqrt(Math.max(1, node.weight)) * 3));
    const previous = previousPositions?.get(node.id);
    if (previous) {
      return { ...node, x: previous.x, y: previous.y, r };
    }
    if (node.kind === "tenant") {
      return { ...node, x: centerX, y: centerY, r };
    }
    if (node.kind !== "entity") {
      const angle = (Math.PI * 2 * index) / Math.max(1, hubNodes.length) - Math.PI / 2;
      return {
        ...node,
        x: centerX + Math.cos(angle) * Math.min(260, bounds.width * 0.11),
        y: centerY + Math.sin(angle) * Math.min(190, bounds.height * 0.1),
        r,
      };
    }
    const anchor = communityCenters.get(node.community ?? node.entityType ?? "entity") ?? { x: centerX, y: centerY };
    const jitter = deterministicJitter(node.id);
    return {
      ...node,
      x: anchor.x + jitter.x * 86,
      y: anchor.y + jitter.y * 62,
      r,
    };
  });
  const byId = new Map(positioned.map((node) => [node.id, node]));
  const velocity = new Map(positioned.map((node) => [node.id, { x: 0, y: 0 }]));

  for (let iteration = 0; iteration < 170; iteration += 1) {
    for (let leftIndex = 0; leftIndex < positioned.length; leftIndex += 1) {
      const left = positioned[leftIndex]!;
      for (let rightIndex = leftIndex + 1; rightIndex < positioned.length; rightIndex += 1) {
        const right = positioned[rightIndex]!;
        const dx = right.x - left.x || 0.01;
        const dy = right.y - left.y || 0.01;
        const distance = Math.max(22, Math.hypot(dx, dy));
        const force = Math.min(10, (9200 / (distance * distance)) * (left.kind === right.kind ? 1 : 0.72));
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        velocity.get(left.id)!.x -= fx;
        velocity.get(left.id)!.y -= fy;
        velocity.get(right.id)!.x += fx;
        velocity.get(right.id)!.y += fy;
      }
    }

    for (const edge of edges) {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const desired = edgeIdealDistance(edge);
      const force = (distance - desired) * edgeSpringStrength(edge);
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      if (source.kind !== "tenant") {
        velocity.get(source.id)!.x += fx;
        velocity.get(source.id)!.y += fy;
      }
      if (target.kind !== "tenant") {
        velocity.get(target.id)!.x -= fx;
        velocity.get(target.id)!.y -= fy;
      }
    }

    for (const node of positioned) {
      if (node.kind === "tenant") {
        node.x = centerX;
        node.y = centerY;
        continue;
      }
      const anchor = node.kind === "entity"
        ? communityCenters.get(node.community ?? node.entityType ?? "entity") ?? { x: centerX, y: centerY }
        : { x: centerX, y: centerY };
      const pull = node.kind === "entity" ? 0.012 : 0.018;
      const currentVelocity = velocity.get(node.id)!;
      currentVelocity.x += (anchor.x - node.x) * pull;
      currentVelocity.y += (anchor.y - node.y) * pull;
      currentVelocity.x *= 0.72;
      currentVelocity.y *= 0.72;
      node.x = clampNumber(node.x + currentVelocity.x, bounds.minX + 36, bounds.maxX - 36);
      node.y = clampNumber(node.y + currentVelocity.y, bounds.minY + 36, bounds.maxY - 36);
    }
  }

  return positioned.sort((left, right) => (left.kind === "tenant" ? 1 : 0) - (right.kind === "tenant" ? 1 : 0));
}

function edgeIdealDistance(edge: AiGraphEdge) {
  if (edge.type === "CO_OCCURS") {
    const signal = Math.min(10, Math.max(1, edge.signalCount ?? 1));
    const weightedSignal = Math.log1p(Math.max(1, edge.weight)) * 36 + signal * 8;
    return clampNumber(260 - weightedSignal, 72, 220);
  }
  if (edge.type === "TYPE_MEMBER") return 124;
  if (edge.type === "TYPE_GROUP") return 150;
  if (edge.type === "CATEGORY_SIGNAL") return 150;
  if (edge.type === "CATEGORY_GROUP") return 178;
  return 170;
}

function edgeSpringStrength(edge: AiGraphEdge) {
  const weight = Math.sqrt(Math.max(1, edge.weight));
  if (edge.type === "CO_OCCURS") return 0.008 + Math.min(0.03, weight * 0.006);
  if (edge.type === "TYPE_MEMBER") return 0.012;
  if (edge.type === "CATEGORY_SIGNAL") return 0.01;
  return 0.007;
}

function edgePath(source: PositionedGraphNode, target: PositionedGraphNode) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const curve = Math.min(44, Math.max(12, distance * 0.08));
  const sign = deterministicJitter(`${source.id}->${target.id}`).x > 0 ? 1 : -1;
  const cx = (source.x + target.x) / 2 + (-dy / distance) * curve * sign;
  const cy = (source.y + target.y) / 2 + (dx / distance) * curve * sign;
  return `M ${source.x.toFixed(1)} ${source.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${target.x.toFixed(1)} ${target.y.toFixed(1)}`;
}

function edgeStroke(type: string | undefined, graphTheme: GraphColorTheme) {
  if (type === "CO_OCCURS") return graphTheme.edges.CO_OCCURS;
  if (type === "CATEGORY_SIGNAL" || type === "CATEGORY_GROUP") return graphTheme.edges.CATEGORY;
  if (type === "TYPE_MEMBER" || type === "TYPE_GROUP") return graphTheme.edges.TYPE;
  return graphTheme.edges.DEFAULT;
}

function edgeDash(type?: string) {
  if (type === "CATEGORY_SIGNAL") return "4 4";
  if (type === "TYPE_MEMBER") return "2 5";
  return undefined;
}

function edgeWidth(edge: AiGraphEdge) {
  const base = Math.sqrt(Math.max(1, edge.weight));
  return Math.max(1, Math.min(5, base * (edge.type === "CO_OCCURS" ? 0.9 : 0.55)));
}

function edgeLabelText(edge: AiGraphEdge) {
  if (edge.type === "CO_OCCURS") return edge.label || "共现";
  return null;
}

function edgeLabelWidth(label: string) {
  return Math.min(118, Math.max(36, shortLabel(label, 14).length * 8 + 14));
}

function nodeFillForNode(node: AiGraphNode, graphTheme: GraphColorTheme) {
  if (node.kind === "tenant") return graphTheme.nodes.tenant;
  if (node.kind === "type") return graphTheme.nodes.type;
  if (node.kind === "category") return graphTheme.nodes.category;
  if (node.entityType && node.entityType in graphTheme.nodes) return graphTheme.nodes[node.entityType];
  return graphTheme.nodes.default;
}

function nodeFill(kind: string) {
  if (kind === "tenant") return "#2563eb";
  if (kind === "category") return "#16a34a";
  if (kind === "type") return "#7c3aed";
  return "#0ea5e9";
}

function deterministicJitter(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return {
    x: ((hash & 0xff) / 127.5) - 1,
    y: (((hash >> 8) & 0xff) / 127.5) - 1,
  };
}

function shortLabel(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateTimeWithYear(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
