import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  BookOpenIcon,
  CameraIcon,
  CheckIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  HomeIcon,
  ImagePlusIcon,
  KeyRoundIcon,
  LogOutIcon,
  MegaphoneIcon,
  RefreshCwIcon,
  SendIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";
import type { TenantSummary } from "@campux/domain";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type MainTab = "post" | "posts" | "services" | "admin";
type TenantRole = "submitter" | "reviewer" | "admin";

type Membership = {
  id: string;
  role: TenantRole;
  tenant: TenantSummary;
};

type CurrentMembership = {
  id: string;
  role: TenantRole;
};

type MeResponse =
  | { authenticated: false }
  | {
      authenticated: true;
      user: {
        id: string;
        qqUin: string;
        displayName: string | null;
        systemRole: "system_operator" | null;
      };
      memberships: Membership[];
      currentTenant: TenantSummary | null;
      currentMembership: CurrentMembership | null;
      needsTenantSelection: boolean;
    };

type TenantMetadata = {
  brand: string;
  banner: string;
  postRules: string[];
  services: Array<{
    title: string;
    description?: string;
    url?: string;
  }>;
};

type UploadedImage = {
  key: string;
  url: string;
  fileName: string;
  previewUrl: string;
};

type PostItem = {
  id: string;
  displayId: number;
  title: string;
  text: string;
  images: unknown;
  anonymous: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
};

const defaultMetadata: TenantMetadata = {
  brand: "校园墙",
  banner: "",
  postRules: [
    "不发布隐私信息、辱骂、人身攻击和未经确认的指控。",
    "寻物招领请写清地点、时间和联系方式。",
    "图片最多 9 张，审核通过后会同步到本校启用的 QQ 墙号。",
  ],
  services: [
    { title: "修改密码", description: "账号服务" },
    { title: "投稿规则", description: "查看本墙规范" },
    { title: "校园服务", description: "推荐入口" },
  ],
};

const navItems = [
  { value: "post", label: "投稿", emoji: "📝", icon: HomeIcon, minRole: "submitter" },
  { value: "posts", label: "稿件", emoji: "🌏", icon: ClipboardListIcon, minRole: "submitter" },
  { value: "services", label: "服务", emoji: "🛠", icon: SparklesIcon, minRole: "submitter" },
  { value: "admin", label: "管理", emoji: "🔐", icon: ShieldCheckIcon, minRole: "admin" },
] satisfies Array<{ value: MainTab; label: string; emoji: string; icon: typeof HomeIcon; minRole: TenantRole }>;
type NavItem = (typeof navItems)[number];

const roleRank: Record<TenantRole, number> = {
  submitter: 1,
  reviewer: 2,
  admin: 3,
};

const roleLabels: Record<TenantRole, string> = {
  submitter: "投稿者",
  reviewer: "审核员",
  admin: "管理员",
};

const statusLabels: Record<string, string> = {
  pending_approval: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  cancelled: "已取消",
  publishing: "发布中",
  partially_failed: "部分失败",
  failed: "发布失败",
  published: "已发布",
  pending_recall: "待撤回",
  recalled: "已撤回",
};

async function api<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const data = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) {
    throw new Error(data.message || `请求失败：${response.status}`);
  }
  return data as T;
}

function canAccess(role: TenantRole, minRole: TenantRole) {
  return roleRank[role] >= roleRank[minRole];
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [activeTab, setActiveTab] = useState<MainTab>("post");
  const [metadata, setMetadata] = useState<TenantMetadata>(defaultMetadata);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [postText, setPostText] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedTenant = me?.authenticated ? me.currentTenant : tenants[0];
  const currentRole = me?.authenticated ? me.currentMembership?.role : undefined;
  const availableNavItems = useMemo(() => {
    if (!currentRole) {
      return navItems.filter((item) => item.value !== "admin");
    }
    return navItems.filter((item) => canAccess(currentRole, item.minRole));
  }, [currentRole]);

  async function refreshMe() {
    const data = await api<MeResponse>("/api/me");
    setMe(data);
  }

  async function refreshTenantData() {
    if (!me?.authenticated || !me.currentTenant) {
      return;
    }

    const [metadataData, postsData] = await Promise.all([
      api<TenantMetadata>("/api/tenant/metadata"),
      api<{ posts: PostItem[] }>("/api/posts/mine"),
    ]);
    setMetadata(metadataData);
    setPosts(postsData.posts);
  }

  useEffect(() => {
    let ignore = false;
    async function boot() {
      try {
        const [meData, tenantData] = await Promise.all([
          api<MeResponse>("/api/me"),
          api<{ tenants: TenantSummary[] }>("/api/tenants"),
        ]);
        if (!ignore) {
          setMe(meData);
          setTenants(tenantData.tenants);
        }
      } catch (caught) {
        if (!ignore) {
          setError(caught instanceof Error ? caught.message : "无法连接到 Campux API");
          setMe({ authenticated: false });
        }
      }
    }

    void boot();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    void refreshTenantData().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "无法读取校园墙数据");
    });
  }, [me]);

  useEffect(() => {
    if (!availableNavItems.some((item) => item.value === activeTab)) {
      setActiveTab(availableNavItems[0]?.value ?? "post");
    }
  }, [activeTab, availableNavItems]);

  async function login(qqUin: string, password: string) {
    setError("");
    const data = await api<MeResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ qqUin, password }),
    });
    setMe(data);
  }

  async function logout() {
    await api<{ ok: true }>("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setMe({ authenticated: false });
    setPostText("");
    setUploadedImages([]);
    setPosts([]);
    setActiveTab("post");
  }

  async function selectTenant(tenantId: string) {
    await api("/api/session/tenant", {
      method: "POST",
      body: JSON.stringify({ tenantId }),
    });
    await refreshMe();
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      const nextImages: UploadedImage[] = [];
      for (const file of Array.from(files).slice(0, 9 - uploadedImages.length)) {
        const previewUrl = await fileToBase64(file);
        const uploaded = await api<Omit<UploadedImage, "previewUrl">>("/api/uploads/post-images", {
          method: "POST",
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type || "application/octet-stream",
            base64: previewUrl,
          }),
        });
        nextImages.push({ ...uploaded, previewUrl });
      }
      setUploadedImages((current) => [...current, ...nextImages]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "图片上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function submitPost() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/api/posts", {
        method: "POST",
        body: JSON.stringify({
          text: postText,
          anonymous,
          images: uploadedImages.map(({ key, url, fileName }) => ({ key, url, fileName })),
        }),
      });
      setPostText("");
      setUploadedImages([]);
      setAnonymous(false);
      setNotice("投稿已提交，等待审核。");
      const data = await api<{ posts: PostItem[] }>("/api/posts/mine");
      setPosts(data.posts);
      setActiveTab("posts");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "投稿失败");
    } finally {
      setBusy(false);
    }
  }

  if (!me) {
    return <LoadingScreen />;
  }

  if (!me.authenticated) {
    return <LoginScreen selectedTenant={selectedTenant ?? undefined} error={error} onLogin={login} />;
  }

  if (me.needsTenantSelection || !me.currentTenant || !me.currentMembership) {
    return <TenantSelectionScreen me={me} onSelectTenant={selectTenant} onLogout={logout} />;
  }

  return (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as MainTab)} className="min-h-dvh">
      <div className="min-h-dvh bg-background md:flex">
        <DesktopSidebar
          activeTab={activeTab}
          me={me}
          navItems={availableNavItems}
          selectedTenant={me.currentTenant}
          onLogout={logout}
        />

        <div className="min-h-dvh w-full bg-background pb-24 md:max-w-[760px] md:border-r md:border-slate-100 md:pb-8">
          <Header me={me} selectedTenant={me.currentTenant} onLogout={logout} />

          <main>
            <TabsContent value="post" className="m-0">
              <PostPage
                busy={busy}
                error={error}
                metadata={metadata}
                notice={notice}
                postText={postText}
                anonymous={anonymous}
                selectedTenant={me.currentTenant}
                uploadedImages={uploadedImages}
                onAnonymousChange={setAnonymous}
                onFilesSelected={uploadFiles}
                onPostTextChange={setPostText}
                onSubmit={submitPost}
                onRemoveImage={(key) => setUploadedImages((current) => current.filter((image) => image.key !== key))}
              />
            </TabsContent>

            <TabsContent value="posts" className="m-0">
              <PostsPage posts={posts} currentRole={me.currentMembership.role} onRefresh={refreshTenantData} />
            </TabsContent>

            <TabsContent value="services" className="m-0">
              <ServicesPage services={metadata.services} />
            </TabsContent>

            <TabsContent value="admin" className="m-0">
              <AdminPage selectedTenant={me.currentTenant} />
            </TabsContent>
          </main>
        </div>
      </div>

      <TabsList
        className="fixed inset-x-0 bottom-0 z-40 mx-auto grid h-[64px] max-w-[480px] rounded-none border-x-0 border-b-0 bg-white px-2 pb-1 pt-1 shadow-[0_-2px_10px_rgba(0,0,0,0.08)] md:hidden"
        style={{ gridTemplateColumns: `repeat(${availableNavItems.length}, minmax(0, 1fr))` }}
      >
        {availableNavItems.map((item) => {
          const Icon = item.icon;

          return (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="h-14 flex-col gap-0.5 rounded-lg text-xs text-slate-500 data-[state=active]:bg-transparent data-[state=active]:text-sky-600 data-[state=active]:shadow-none"
            >
              <Icon data-icon="inline-start" />
              {item.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}

function LoadingScreen() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-white">
      <p className="text-lg font-bold text-slate-500">Loading...</p>
    </main>
  );
}

function LoginScreen({
  selectedTenant,
  error,
  onLogin,
}: {
  selectedTenant: TenantSummary | undefined;
  error: string;
  onLogin: (qqUin: string, password: string) => Promise<void>;
}) {
  const [qqUin, setQqUin] = useState("10000");
  const [password, setPassword] = useState("campux123");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onLogin(qqUin, password);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-white">
      <section className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col px-4 pt-3 md:justify-center md:px-8 md:pt-0">
        <div className="md:mb-8">
          <h1 className="inline-block pr-2 text-[1.65rem] font-black leading-tight tracking-tight text-slate-950">Campux</h1>
          <span className="align-baseline text-sm text-slate-600">{selectedTenant?.name ?? "校园墙"}</span>
        </div>

        <form className="mt-12 rounded-md bg-sky-50 px-4 py-5 md:mt-0" onSubmit={handleSubmit}>
          <p className="text-xl font-bold text-slate-950">登录到 Campux</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">输入通过校园墙机器人注册的账号和密码。</p>
          <div className="mt-5 grid gap-3">
            <Input value={qqUin} inputMode="numeric" placeholder="QQ 号 / UIN" onChange={(event) => setQqUin(event.target.value)} />
            <Input value={password} type="password" placeholder="密码" onChange={(event) => setPassword(event.target.value)} />
          </div>
          {error ? <p className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}
          <Button className="mt-5 rounded-full bg-[#42a5f5] px-8 font-bold hover:bg-[#42a5f5]" disabled={busy} type="submit">
            {busy ? "登录中" : "登录"}
          </Button>
          <div className="mt-4 text-xs leading-5 text-slate-500">
            <p>测试账号密码均为 `campux123`：</p>
            <p>10000 投稿者，20000 审核员，30000 多墙管理员，40000 系统运维。</p>
          </div>
        </form>
      </section>
    </main>
  );
}

function TenantSelectionScreen({
  me,
  onSelectTenant,
  onLogout,
}: {
  me: Extract<MeResponse, { authenticated: true }>;
  onSelectTenant: (tenantId: string) => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const [busyTenantId, setBusyTenantId] = useState("");

  async function select(tenantId: string) {
    setBusyTenantId(tenantId);
    try {
      await onSelectTenant(tenantId);
    } finally {
      setBusyTenantId("");
    }
  }

  return (
    <main className="min-h-dvh bg-white">
      <section className="mx-auto w-full max-w-[560px] px-4 pt-3 md:px-8 md:pt-12">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="inline-block pr-2 text-[1.65rem] font-black leading-tight tracking-tight text-slate-950">Campux</h1>
            <span className="align-baseline text-sm text-slate-600">选择校园墙</span>
          </div>
          <Button variant="outline" size="sm" onClick={onLogout}>
            <LogOutIcon data-icon="inline-start" />
            退出
          </Button>
        </div>

        <div className="mt-8">
          <p className="text-xl font-bold text-slate-950">{me.user.displayName ?? me.user.qqUin}</p>
          <p className="mt-2 text-sm text-slate-500">你的账号可以进入多个校园墙，请选择本次要使用的校园墙。</p>
        </div>

        <div className="mt-5 grid gap-3">
          {me.memberships.length === 0 ? (
            <Card className="bg-orange-50">
              <CardContent className="p-4 text-sm font-medium text-orange-900">暂无可访问的校园墙，请先通过对应校园墙机器人注册。</CardContent>
            </Card>
          ) : null}
          {me.memberships.map((membership) => (
            <Button
              key={membership.id}
              variant="outline"
              className="h-auto justify-between rounded-md p-4 text-left"
              disabled={busyTenantId === membership.tenant.id}
              onClick={() => void select(membership.tenant.id)}
            >
              <span>
                <span className="block font-bold">{membership.tenant.name}</span>
                <span className="text-xs text-slate-500">{roleLabels[membership.role]}</span>
              </span>
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          ))}
        </div>

        {me.user.systemRole === "system_operator" ? (
          <div className="mt-5 rounded-md bg-slate-100 p-4">
            <p className="font-bold">系统运维面板</p>
            <p className="mt-1 text-sm text-slate-500">运维入口将在系统后台 Phase 中接入。</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function DesktopSidebar({
  selectedTenant,
  activeTab,
  me,
  navItems,
  onLogout,
}: {
  selectedTenant: TenantSummary;
  activeTab: MainTab;
  me: Extract<MeResponse, { authenticated: true }>;
  navItems: NavItem[];
  onLogout: () => void;
}) {
  const role = me.currentMembership?.role ?? "submitter";

  return (
    <aside className="hidden h-dvh w-[178px] shrink-0 border-r border-slate-100 bg-white md:flex md:flex-col">
      <div className="bg-[#42a5f5] py-2 text-center text-2xl font-black text-white">Campux</div>

      <div className="flex min-h-0 flex-1 flex-col justify-between px-3 py-4">
        <TabsList className="grid h-auto w-full grid-cols-1 gap-1 bg-transparent p-0">
          {navItems.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="h-11 justify-start rounded-md px-3 text-base text-slate-800 shadow-none data-[state=active]:bg-sky-50 data-[state=active]:font-extrabold data-[state=active]:text-slate-950 data-[state=active]:shadow-none"
            >
              <span className="mr-2 text-lg">{item.emoji}</span>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <AccountMenu me={me} selectedTenant={selectedTenant} roleLabel={roleLabels[role]} onLogout={onLogout} variant="desktop" />
      </div>
    </aside>
  );
}

function Header({
  selectedTenant,
  me,
  onLogout,
}: {
  selectedTenant: TenantSummary;
  me: Extract<MeResponse, { authenticated: true }>;
  onLogout: () => void;
}) {
  const role = me.currentMembership?.role ?? "submitter";
  return (
    <header className="bg-background pb-2">
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <div className="min-w-0">
          <h1 className="inline-block pr-2 text-[1.65rem] font-black leading-tight tracking-tight text-slate-950">Campux</h1>
          <span className="align-baseline text-sm text-slate-600">{selectedTenant.name}</span>
        </div>
        <AccountMenu me={me} selectedTenant={selectedTenant} roleLabel={roleLabels[role]} onLogout={onLogout} variant="mobile" />
      </div>
    </header>
  );
}

function AccountMenu({
  selectedTenant,
  me,
  roleLabel,
  onLogout,
  variant,
}: {
  selectedTenant: TenantSummary;
  me: Extract<MeResponse, { authenticated: true }>;
  roleLabel: string;
  onLogout: () => void;
  variant: "mobile" | "desktop";
}) {
  const isDesktop = variant === "desktop";
  const displayName = me.user.displayName ?? me.user.qqUin;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={
            isDesktop
              ? "flex w-full items-center gap-3 rounded-md px-1 py-2 text-left hover:bg-slate-50"
              : "flex h-[42px] w-[42px] items-center justify-center rounded-full"
          }
          aria-label="账户菜单"
        >
          <Avatar className={isDesktop ? "h-[50px] w-[50px]" : "h-[38px] w-[38px]"}>
            <AvatarImage src="https://q1.qlogo.cn/g?b=qq&nk=10000&s=100" alt="用户头像" />
            <AvatarFallback>QQ</AvatarFallback>
          </Avatar>
          {isDesktop ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-bold">{displayName}</p>
              <p className="truncate text-xs text-slate-500">{roleLabel}</p>
            </div>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={isDesktop ? "start" : "end"} className="w-52">
        <DropdownMenuLabel>
          <span className="block text-sm font-semibold text-slate-900">{displayName}</span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">{selectedTenant.name} · {roleLabel}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onLogout}>
          <LogOutIcon data-icon="inline-start" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PostPage({
  busy,
  error,
  metadata,
  notice,
  postText,
  anonymous,
  selectedTenant,
  uploadedImages,
  onPostTextChange,
  onAnonymousChange,
  onFilesSelected,
  onRemoveImage,
  onSubmit,
}: {
  busy: boolean;
  error: string;
  metadata: TenantMetadata;
  notice: string;
  postText: string;
  anonymous: boolean;
  selectedTenant: TenantSummary;
  uploadedImages: UploadedImage[];
  onPostTextChange: (value: string) => void;
  onAnonymousChange: (value: boolean) => void;
  onFilesSelected: (files: FileList | null) => void;
  onRemoveImage: (key: string) => void;
  onSubmit: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rules = metadata.postRules.length > 0 ? metadata.postRules : defaultMetadata.postRules;

  return (
    <div className="flex flex-col">
      {metadata.banner ? (
        <div className="flex min-h-10 items-center gap-2 bg-[#f8b94c] px-4 py-2 text-sm text-white">
          <MegaphoneIcon className="size-4 shrink-0" strokeWidth={2.3} />
          <p className="min-w-0 truncate">{metadata.banner}</p>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive" className="mx-4 my-2">
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert className="mx-4 my-2 border-green-200 bg-green-50">
          <CheckIcon />
          <AlertTitle>提交成功</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <section className="px-4 pt-4">
        <div className="flex gap-3">
          <Avatar size="lg" className="h-[50px] w-[50px] shrink-0">
            <AvatarImage src="https://q1.qlogo.cn/g?b=qq&nk=10000&s=100" alt="用户头像" />
            <AvatarFallback>QQ</AvatarFallback>
          </Avatar>
          <Textarea
            value={postText}
            maxLength={1000}
            placeholder="有什么新鲜事？！"
            className="min-h-40 flex-1 resize-none rounded-none border-0 bg-white p-4 text-base leading-7 shadow-none focus-visible:ring-0"
            onChange={(event) => onPostTextChange(event.target.value)}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {uploadedImages.map((image) => (
            <button key={image.key} className="h-[70px] w-[70px] overflow-hidden rounded-[10px] bg-slate-100" onClick={() => onRemoveImage(image.key)}>
              <img src={image.previewUrl} alt={image.fileName} className="h-full w-full object-cover" />
            </button>
          ))}
          {uploadedImages.length < 9 ? (
            <Button
              variant="outline"
              className="h-[70px] w-[70px] rounded-none border-0 bg-white p-0 text-black shadow-none hover:bg-white"
              disabled={busy}
              aria-label="添加图片"
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlusIcon className="!size-[70px] stroke-[1.35]" />
            </Button>
          ) : null}
          <input ref={inputRef} hidden multiple accept="image/*" type="file" onChange={(event) => onFilesSelected(event.target.files)} />
        </div>

        <div className="mt-3 w-fit rounded-[5px] bg-[#8bc34a] px-2 py-1 text-lg text-white shadow-sm">
          <div className="flex items-center gap-4">
            <span>匿名投稿</span>
            <Switch checked={anonymous} onCheckedChange={onAnonymousChange} aria-label="匿名投稿" />
          </div>
        </div>

        <Drawer>
          <DrawerTrigger asChild>
            <button className="mt-2 block w-fit rounded-[5px] bg-[#ff8a65] px-2 py-1 text-left text-lg text-white shadow-sm">
              <span>
                请务必遵守 <strong className="inline font-bold">投稿规则</strong>
              </span>
            </button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>投稿规则</DrawerTitle>
              <DrawerDescription>发布前请确认内容符合当前校园墙规范。</DrawerDescription>
            </DrawerHeader>
            <div className="flex flex-col gap-3 px-4">
              {rules.map((rule, index) => (
                <Alert key={rule} className="rounded-2xl">
                  <CheckIcon />
                  <AlertTitle>规则 {index + 1}</AlertTitle>
                  <AlertDescription>{rule}</AlertDescription>
                </Alert>
              ))}
            </div>
            <DrawerFooter>
              <DrawerClose asChild>
                <Button>好的</Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>

        <div className="mt-4 flex items-center gap-3">
          <button className="campux-postbtn" disabled={busy || postText.trim().length === 0} onClick={onSubmit}>
            <span>
              <SendIcon className="mr-1 inline size-4" />
              {busy ? "提交中" : "投稿"}
            </span>
          </button>
          <span className="text-xs text-slate-400">{postText.length}/1000</span>
        </div>
      </section>

      <section className="mx-4 mt-4 rounded-md bg-sky-50 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-slate-900">稿件状态</p>
            <p className="mt-1 text-sm text-slate-500">
              审核通过后会同步到 {selectedTenant.botAccountCount} 个墙号。
            </p>
          </div>
          <Badge variant="secondary" className="rounded-md shadow-none">无阻塞</Badge>
        </div>
      </section>
    </div>
  );
}

function PostsPage({
  posts,
  currentRole,
  onRefresh,
}: {
  posts: PostItem[];
  currentRole: TenantRole;
  onRefresh: () => Promise<void>;
}) {
  const canReview = canAccess(currentRole, "reviewer");
  return (
    <div className="px-4">
      <SectionHeader title="稿件" subtitle="你的稿件、动态和审核流" action="刷新" icon={RefreshCwIcon} onAction={onRefresh} />
      <Tabs defaultValue="mine" className="mt-3">
        <TabsList className={`grid w-full ${canReview ? "grid-cols-3" : "grid-cols-2"}`}>
          <TabsTrigger value="mine">你的稿件</TabsTrigger>
          <TabsTrigger value="feed">动态</TabsTrigger>
          {canReview ? <TabsTrigger value="review">审核</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="mine" className="mt-3">
          <PostList posts={posts} />
        </TabsContent>
        <TabsContent value="feed" className="mt-3">
          <EmptyCard title="前面的区域，以后再来探索吧" />
        </TabsContent>
        {canReview ? (
          <TabsContent value="review" className="mt-3">
            <EmptyCard title="审核工作流会在 Phase 4 接入" />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

function ServicesPage({ services }: { services: TenantMetadata["services"] }) {
  const entries = services.length > 0 ? services : defaultMetadata.services;
  return (
    <div className="px-4">
      <SectionHeader title="服务" subtitle="账号服务与推荐网站" />
      <div className="mt-3 flex flex-col gap-2">
        {entries.map((service) => (
          <ListButton key={service.title} title={service.title} description={service.description ?? "校园服务"} icon={service.title.includes("密码") ? KeyRoundIcon : SparklesIcon} />
        ))}
      </div>
    </div>
  );
}

function AdminPage({ selectedTenant }: { selectedTenant: TenantSummary }) {
  return (
    <div className="px-4">
      <SectionHeader title="管理" subtitle={`${selectedTenant.name} 的审核和配置`} />
      <div className="mt-3 flex flex-col gap-2">
        <ListButton title="审核稿件" description={`${selectedTenant.pendingPostCount} 条待审核`} icon={ClipboardListIcon} />
        <ListButton title="校园墙设置" description="品牌、公告、规则" icon={MegaphoneIcon} />
        <ListButton title="发布目标" description={`${selectedTenant.botAccountCount} 个 QQ 墙号`} icon={ShieldCheckIcon} />
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  action,
  icon: Icon,
  onAction,
}: {
  title: string;
  subtitle: string;
  action?: string;
  icon?: typeof RefreshCwIcon;
  onAction?: () => void | Promise<void>;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="text-2xl font-black">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {action && Icon ? (
        <Button variant="outline" size="sm" onClick={() => void onAction?.()}>
          <Icon data-icon="inline-start" />
          {action}
        </Button>
      ) : null}
    </div>
  );
}

function PostList({ posts }: { posts: PostItem[] }) {
  if (posts.length === 0) {
    return <EmptyCard title="还没有稿件" />;
  }

  return (
    <div className="flex flex-col gap-2">
      {posts.map((post) => (
        <Button key={post.id} variant="secondary" className="h-auto justify-between rounded-xl p-3">
          <span className="min-w-0 text-left">
            <span className="block truncate font-medium">{post.title}</span>
            <span className="text-xs text-muted-foreground">#{post.displayId}</span>
          </span>
          <Badge variant={post.status === "pending_approval" ? "destructive" : "secondary"}>{statusLabels[post.status] ?? post.status}</Badge>
        </Button>
      ))}
    </div>
  );
}

function ListButton({ title, description, icon: Icon }: { title: string; description: string; icon: typeof KeyRoundIcon }) {
  return (
    <Button variant="outline" className="h-auto justify-start gap-3 rounded-xl p-3">
      <Icon data-icon="inline-start" />
      <span className="flex min-w-0 flex-1 flex-col items-start">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRightIcon data-icon="inline-end" />
    </Button>
  );
}

function EmptyCard({ title }: { title: string }) {
  return (
    <Card className="bg-muted/70">
      <CardContent className="flex min-h-40 items-center justify-center p-6 text-center font-semibold">{title}</CardContent>
    </Card>
  );
}
