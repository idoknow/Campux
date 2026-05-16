import { useEffect, useMemo, useState } from "react";
import type { TenantSummary } from "@campux/domain";
import { toast } from "sonner";
import { api, fileToBase64 } from "@/lib/api";
import { canAccess, defaultMetadata, navItems } from "@/lib/app-model";
import type { AdminTab, AuthenticatedMe, MainTab, MeResponse, OAuthAuthorizeClientResponse, Pagination, PostItem, PostsTab, TenantMetadata, UploadedImage } from "@/types/app";
import { LoadingScreen } from "@/features/auth/LoadingScreen";
import { LoginScreen } from "@/features/auth/LoginScreen";
import { BannedScreen } from "@/features/auth/BannedScreen";
import { RequiredPasswordChangeScreen } from "@/features/auth/RequiredPasswordChangeScreen";
import { TenantSelectionScreen } from "@/features/auth/TenantSelectionScreen";
import { OAuthAuthorizeScreen } from "@/features/oauth/OAuthAuthorizeScreen";
import { OpsStandaloneScreen } from "@/features/ops/OpsStandaloneScreen";
import { AppShell } from "@/features/shell/AppShell";

type AppRoute =
  | { kind: "tenant"; tab: MainTab; subTab?: AdminTab | PostsTab }
  | { kind: "login" | "tenants" | "ops" }
  | { kind: "oauth"; search: string };

const tabPaths: Record<MainTab, string> = {
  post: "/post",
  posts: "/posts",
  stats: "/stats",
  services: "/services",
  admin: "/admin",
};

const postsTabPaths: Record<PostsTab, string> = {
  mine: "/posts",
  review: "/posts/review",
};

const adminTabPaths: Record<AdminTab, string> = {
  users: "/admin",
  bans: "/admin/bans",
  metadata: "/admin/metadata",
  bots: "/admin/bots",
  publish: "/admin/publish",
};

const mainTabTitles: Record<MainTab, string> = {
  post: "投稿",
  posts: "稿件",
  stats: "统计",
  services: "服务",
  admin: "管理",
};

const postsTabTitles: Record<PostsTab, string> = {
  mine: "你的稿件",
  review: "审核稿件",
};

const adminTabTitles: Record<AdminTab, string> = {
  users: "用户管理",
  bans: "封禁管理",
  metadata: "元数据管理",
  bots: "机器人管理",
  publish: "发布管理",
};

export function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [authContext, setAuthContext] = useState<{ managementHost: boolean }>({ managementHost: false });
  const [route, setRoute] = useState<AppRoute>(() => routeFromPath(window.location.pathname));
  const [activeTab, setActiveTabState] = useState<MainTab>(() => {
    const initialRoute = routeFromPath(window.location.pathname);
    return initialRoute.kind === "tenant" ? initialRoute.tab : "post";
  });
  const [metadata, setMetadata] = useState<TenantMetadata>(defaultMetadata);
  const [oauthClientResponse, setOAuthClientResponse] = useState<OAuthAuthorizeClientResponse | null>(null);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [postsPagination, setPostsPagination] = useState<Pagination>(() => defaultPagination());
  const [postsPage, setPostsPage] = useState(1);
  const [tenantDataLoading, setTenantDataLoading] = useState(false);
  const [postText, setPostText] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedTenant = me?.authenticated ? me.currentTenant : tenants[0];
  const currentRole = me?.authenticated ? me.currentMembership?.role : undefined;
  const documentTenantName = route.kind === "tenant" ? selectedTenant?.name : undefined;
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

  function navigate(nextRoute: AppRoute, mode: "push" | "replace" = "push") {
    const path = pathFromRoute(nextRoute);
    const currentPath = `${window.location.pathname}${window.location.search}`;
    if (currentPath !== path) {
      window.history[mode === "replace" ? "replaceState" : "pushState"](null, "", path);
    }
    setRoute(nextRoute);
    if (nextRoute.kind === "tenant") {
      setActiveTabState(nextRoute.tab);
    }
  }

  function setActiveTab(tab: MainTab) {
    navigate({ kind: "tenant", tab });
  }

  function setPostsSubTab(tab: PostsTab) {
    navigate({ kind: "tenant", tab: "posts", subTab: tab });
  }

  function setAdminSubTab(tab: AdminTab) {
    navigate({ kind: "tenant", tab: "admin", subTab: tab });
  }

  useEffect(() => {
    if (route.kind !== "oauth" || !me?.authenticated || !me.currentTenant || !me.currentMembership) {
      setOAuthClientResponse(null);
      return;
    }

    const searchParams = new URLSearchParams(route.search);
    const clientId = searchParams.get("client_id");
    if (!clientId) {
      setOAuthClientResponse(null);
      return;
    }

    let ignore = false;
    void api<OAuthAuthorizeClientResponse>(`/api/oauth/clients/${encodeURIComponent(clientId)}`)
      .then((data) => {
        if (!ignore) {
          setOAuthClientResponse(data);
        }
      })
      .catch((caught) => {
        if (!ignore) {
          setOAuthClientResponse(null);
          toast.error(caught instanceof Error ? caught.message : "无法读取 OAuth 应用信息");
        }
      });

    return () => {
      ignore = true;
    };
  }, [me, route]);

  async function refreshTenantData(page = postsPage) {
    if (!me?.authenticated || !me.currentTenant || me.activeBan) {
      return;
    }

    setTenantDataLoading(true);
    try {
      const [metadataData, postsData] = await Promise.all([
        api<TenantMetadata>("/api/tenant/metadata"),
        api<{ posts: PostItem[]; pagination: Pagination }>(`/api/posts/mine?page=${page}&limit=${postsPagination.limit}`),
      ]);
      setMetadata(metadataData);
      setPosts(postsData.posts);
      setPostsPagination(postsData.pagination);
      setPostsPage(postsData.pagination.page);
    } finally {
      setTenantDataLoading(false);
    }
  }

  useEffect(() => {
    let ignore = false;
    async function boot() {
      try {
        const [meData, tenantData] = await Promise.all([
          api<MeResponse>("/api/me"),
          api<{ tenants: TenantSummary[] }>("/api/tenants"),
          api<{ managementHost: boolean }>("/api/auth/context").then((data) => {
            if (!ignore) setAuthContext(data);
            return data;
          }),
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
    const syncRoute = () => {
      const nextRoute = routeFromPath(window.location.pathname);
      setRoute(nextRoute);
      if (nextRoute.kind === "tenant") {
        setActiveTabState(nextRoute.tab);
      }
    };
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    void refreshTenantData().catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取校园墙数据");
    });
  }, [me]);

  useEffect(() => {
    if (!me?.authenticated || !me.currentTenant || me.activeBan) {
      return;
    }
    void refreshTenantData(postsPage).catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取稿件列表");
    });
  }, [postsPage]);

  useEffect(() => {
    if (!me?.authenticated || !me.currentMembership) {
      return;
    }

    if (!availableNavItems.some((item) => item.value === activeTab)) {
      setActiveTab(availableNavItems[0]?.value ?? "post");
    }
  }, [activeTab, availableNavItems, me]);

  useEffect(() => {
    if (!me) {
      return;
    }

    if (!me.authenticated) {
      if (route.kind !== "login" && route.kind !== "oauth") {
        navigate({ kind: "login" }, "replace");
      }
      return;
    }

    if (route.kind === "login") {
      navigate(me.needsTenantSelection || !me.currentTenant ? { kind: "tenants" } : { kind: "tenant", tab: activeTab }, "replace");
      return;
    }

    if (route.kind === "ops" && !canOpenOps(me)) {
      navigate(me.needsTenantSelection || !me.currentTenant ? { kind: "tenants" } : { kind: "tenant", tab: activeTab }, "replace");
      return;
    }

    if ((me.needsTenantSelection || !me.currentTenant || !me.currentMembership) && route.kind !== "tenants" && route.kind !== "ops" && route.kind !== "oauth") {
      navigate({ kind: "tenants" }, "replace");
      return;
    }

    if (route.kind === "tenant" && window.location.pathname !== pathFromRoute(route)) {
      navigate(route, "replace");
    }
  }, [me, route.kind, route.kind === "tenant" ? route.tab : undefined, route.kind === "tenant" ? route.subTab : undefined]);

  useEffect(() => {
    document.title = buildDocumentTitle(route, documentTenantName, me?.authenticated ? me.user.systemRole : null);
  }, [route, documentTenantName, me]);

  async function login(account: string, password: string) {
    setError("");
    const data = await api<MeResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ account, password }),
    });
    setMe(data);
    if (data.authenticated) {
      if (route.kind === "oauth") {
        return;
      }
      if (data.user.passwordChangeRequired) {
        navigate({ kind: "login" }, "replace");
        return;
      }
      navigate(data.needsTenantSelection ? { kind: "tenants" } : { kind: "tenant", tab: activeTab });
    }
  }

  function completeRegistration(data: MeResponse) {
    setMe(data);
    setError("");
    if (data.authenticated) {
      navigate(canOpenOps(data) ? { kind: "ops" } : data.needsTenantSelection ? { kind: "tenants" } : { kind: "tenant", tab: activeTab }, "replace");
    }
  }

  async function completeRequiredPasswordChange(newPassword: string) {
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/password/required", {
        method: "POST",
        body: JSON.stringify({ newPassword }),
      });
      const data = await api<MeResponse>("/api/me");
      setMe(data);
      if (data.authenticated) {
        navigate(data.needsTenantSelection ? { kind: "tenants" } : { kind: "tenant", tab: activeTab }, "replace");
      }
      toast.success("密码已更新。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "修改密码失败");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api<{ ok: true }>("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setMe({ authenticated: false });
    setPostText("");
    setUploadedImages([]);
    setPosts([]);
    navigate({ kind: "login" }, "replace");
  }

  async function selectTenant(tenantId: string) {
    await api("/api/session/tenant", {
      method: "POST",
      body: JSON.stringify({ tenantId }),
    });
    await refreshMe();
    if (route.kind === "oauth") {
      return;
    }
    navigate({ kind: "tenant", tab: activeTab });
  }

  async function uploadFiles(files: ArrayLike<File> | null) {
    if (!files?.length) {
      return;
    }

    setBusy(true);
    try {
      const nextImages: UploadedImage[] = [];
      for (const file of Array.from(files).slice(0, 9 - uploadedImages.length)) {
        const previewUrl = await fileToBase64(file);
        const uploaded = await api<Omit<UploadedImage, "previewUrl">>("/api/uploads/post-images", {
          method: "POST",
          body: JSON.stringify({
            fileName: getUploadFileName(file),
            contentType: file.type || "application/octet-stream",
            base64: previewUrl,
          }),
        });
        nextImages.push({ ...uploaded, previewUrl });
      }
      setUploadedImages((current) => [...current, ...nextImages]);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "图片上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function submitPost() {
    setBusy(true);
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
      toast.success("投稿已提交，等待审核。");
      const data = await api<{ posts: PostItem[]; pagination: Pagination }>("/api/posts/mine?page=1&limit=10");
      setPosts(data.posts);
      setPostsPagination(data.pagination);
      setPostsPage(1);
      setActiveTab("posts");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "投稿失败");
    } finally {
      setBusy(false);
    }
  }

  if (!me) {
    return <LoadingScreen />;
  }

  if (!me.authenticated) {
    return <LoginScreen selectedTenant={selectedTenant ?? undefined} error={error} managementHost={authContext.managementHost} onLogin={login} onRegistered={completeRegistration} />;
  }

  if (me.user.passwordChangeRequired) {
    return <RequiredPasswordChangeScreen busy={busy} error={error} onChangePassword={completeRequiredPasswordChange} onLogout={logout} />;
  }

  if (me.currentTenant && me.currentMembership && me.activeBan) {
    return <BannedScreen ban={me.activeBan} me={me} selectedTenant={me.currentTenant} onLogout={logout} />;
  }

  if (route.kind === "tenants") {
    if (canOpenOps(me)) {
      return <TenantSelectionScreen me={me} onSelectTenant={selectTenant} onOpenOps={() => navigate({ kind: "ops" })} onLogout={logout} />;
    }

    return <TenantSelectionScreen me={me} onSelectTenant={selectTenant} onLogout={logout} />;
  }

  if (canOpenOps(me) && (route.kind === "ops" || me.memberships.length === 0)) {
    if (me.memberships.length > 0) {
      return <OpsStandaloneScreen me={me} onBackToTenants={() => navigate({ kind: "tenants" })} onLogout={logout} />;
    }

    return <OpsStandaloneScreen me={me} onLogout={logout} />;
  }

  if (me.needsTenantSelection || !me.currentTenant || !me.currentMembership) {
    if (canOpenOps(me)) {
      return <TenantSelectionScreen me={me} onSelectTenant={selectTenant} onOpenOps={() => navigate({ kind: "ops" })} onLogout={logout} />;
    }

    return (
      <TenantSelectionScreen
        me={me}
        onSelectTenant={selectTenant}
        onLogout={logout}
      />
    );
  }

  if (route.kind === "oauth") {
    return (
      <OAuthAuthorizeScreen
        me={me as AuthenticatedMe & { currentTenant: NonNullable<AuthenticatedMe["currentTenant"]>; currentMembership: NonNullable<AuthenticatedMe["currentMembership"]> }}
        search={route.search}
        clientResponse={oauthClientResponse}
        onLogout={logout}
        onRequireTenantSelection={() => navigate({ kind: "tenants" })}
      />
    );
  }

  return (
    <AppShell
      activeTab={activeTab}
      adminTab={route.kind === "tenant" && route.tab === "admin" ? (route.subTab as AdminTab | undefined) ?? "users" : "users"}
      me={me as AuthenticatedMe & { currentTenant: NonNullable<AuthenticatedMe["currentTenant"]>; currentMembership: NonNullable<AuthenticatedMe["currentMembership"]> }}
      navItems={availableNavItems}
      metadata={metadata}
      posts={posts}
      busy={busy}
      dataLoading={tenantDataLoading}
      postText={postText}
      postsTab={route.kind === "tenant" && route.tab === "posts" ? (route.subTab as PostsTab | undefined) ?? "mine" : "mine"}
      postsPagination={postsPagination}
      anonymous={anonymous}
      uploadedImages={uploadedImages}
      onActiveTabChange={setActiveTab}
      onAdminTabChange={setAdminSubTab}
      onAnonymousChange={setAnonymous}
      onFilesSelected={uploadFiles}
      onLogout={logout}
      onOpenOps={canOpenOps(me) ? () => navigate({ kind: "ops" }) : undefined}
      onSelectTenant={selectTenant}
      onPostTextChange={setPostText}
      onPostsTabChange={setPostsSubTab}
      onRefreshMe={refreshMe}
      onPostsPageChange={setPostsPage}
      onRefreshTenantData={() => refreshTenantData(postsPage)}
      onRemoveImage={(key) => setUploadedImages((current) => current.filter((image) => image.key !== key))}
      onSubmitPost={submitPost}
    />
  );
}

function defaultPagination(): Pagination {
  return {
    page: 1,
    limit: 10,
    total: 0,
    pageCount: 1,
  };
}

function canOpenOps(me: AuthenticatedMe) {
  return me.user.systemRole === "system_operator" || me.user.systemRole === "operations_admin";
}

function routeFromPath(pathname: string): AppRoute {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/login") {
    return { kind: "login" };
  }
  if (normalized === "/tenants") {
    return { kind: "tenants" };
  }
  if (normalized === "/ops") {
    return { kind: "ops" };
  }
  if (normalized === "/oauth/authorize") {
    return { kind: "oauth", search: window.location.search };
  }

  const matchedPostsTab = (Object.entries(postsTabPaths) as Array<[PostsTab, string]>).find(([, path]) => path === normalized)?.[0];
  if (matchedPostsTab) {
    return { kind: "tenant", tab: "posts", subTab: matchedPostsTab };
  }

  const matchedAdminTab = (Object.entries(adminTabPaths) as Array<[AdminTab, string]>).find(([, path]) => path === normalized)?.[0];
  if (matchedAdminTab) {
    return { kind: "tenant", tab: "admin", subTab: matchedAdminTab };
  }

  if (normalized === "/posts/mine") {
    return { kind: "tenant", tab: "posts", subTab: "mine" };
  }
  if (normalized === "/admin/users") {
    return { kind: "tenant", tab: "admin", subTab: "users" };
  }
  if (normalized === "/admin/review") {
    return { kind: "tenant", tab: "posts", subTab: "review" };
  }

  const matchedTab = (Object.entries(tabPaths) as Array<[MainTab, string]>).find(([, path]) => path === normalized)?.[0];
  return {
    kind: "tenant",
    tab: matchedTab ?? "post",
  };
}

function pathFromRoute(route: AppRoute) {
  if (route.kind === "tenant") {
    if (route.tab === "posts" && route.subTab) {
      return postsTabPaths[route.subTab as PostsTab] ?? tabPaths.posts;
    }
    if (route.tab === "admin" && route.subTab) {
      return adminTabPaths[route.subTab as AdminTab] ?? tabPaths.admin;
    }
    return tabPaths[route.tab];
  }
  if (route.kind === "oauth") {
    return `/oauth/authorize${route.search}`;
  }
  return `/${route.kind}`;
}

function getUploadFileName(file: File) {
  if (file.name) {
    return file.name;
  }
  const extension = file.type.split("/")[1]?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "png";
  return `pasted-image.${extension}`;
}

function buildDocumentTitle(route: AppRoute, tenantName?: string, systemRole?: AuthenticatedMe["user"]["systemRole"] | null) {
  const pageTitle = pageTitleFromRoute(route, systemRole);
  const titleParts = route.kind === "tenant" ? [pageTitle, tenantName, "Campux"] : [pageTitle, "Campux"];
  return titleParts.filter(Boolean).join(" - ");
}

function pageTitleFromRoute(route: AppRoute, systemRole?: AuthenticatedMe["user"]["systemRole"] | null) {
  if (route.kind === "login") {
    return "登录";
  }
  if (route.kind === "tenants") {
    return "选择校园墙";
  }
  if (route.kind === "ops") {
    return systemRole === "operations_admin" ? "运营管理" : "运维面板";
  }
  if (route.kind === "oauth") {
    return "OAuth 授权";
  }
  if (route.kind !== "tenant") {
    return "Campux";
  }
  if (route.tab === "posts" && route.subTab) {
    return postsTabTitles[route.subTab as PostsTab] ?? mainTabTitles.posts;
  }
  if (route.tab === "admin" && route.subTab) {
    return adminTabTitles[route.subTab as AdminTab] ?? mainTabTitles.admin;
  }
  return mainTabTitles[route.tab];
}
